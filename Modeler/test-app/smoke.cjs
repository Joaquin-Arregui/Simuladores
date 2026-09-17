const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const puppeteer = require('puppeteer');

// Exercise the shipped web app. The simulator response is mocked at the network
// boundary, so this test needs neither Python nor any external service.
const exampleDirectory = path.resolve(__dirname, '../example');
const fixturesDirectory = path.join(__dirname, 'fixtures');
const chromePaths = [
  process.env.CHROME_BIN,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  puppeteer.executablePath()
].filter(Boolean);

async function serveExample() {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
    '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.woff': 'font/woff', '.woff2': 'font/woff2'
  };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(exampleDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(exampleDirectory + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const content = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      response.end(content);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function openProperty(page, elementId, groupLabel, entryId) {
  await page.click(`.djs-element[data-element-id="${elementId}"] .djs-visual`);
  const selector = `[data-entry-id="${entryId}"] input`;
  const visible = await page.evaluate(selector => {
    const input = document.querySelector(selector);
    return !!input && input.getClientRects().length > 0;
  }, selector);
  if (!visible) {
    await page.waitForFunction(label => [...document.querySelectorAll('.bio-properties-panel-group-header')]
      .some(header => header.textContent.includes(label)), {}, groupLabel);
    await page.evaluate(label => {
      [...document.querySelectorAll('.bio-properties-panel-group-header')]
        .find(header => header.textContent.includes(label)).click();
    }, groupLabel);
  }
  await page.waitForSelector(selector, { visible: true });
  return selector;
}

async function dropDiagram(page, xml) {
  await page.evaluate(xml => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([xml], 'smoke.bpmn', { type: 'application/xml' }));
    document.querySelector('#canvas').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, xml);
}

async function expectSchedulerAlert(page, action) {
  let handler;
  let timeout;
  const warning = new Promise((resolve, reject) => {
    handler = async dialog => {
      const result = { type: dialog.type(), message: dialog.message() };
      try {
        await dialog.accept();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    timeout = setTimeout(() => reject(new Error('A Scheduler import must show a warning')), 15000);
    page.once('dialog', handler);
  });
  try {
    const [, result] = await Promise.all([action(), warning]);
    assert.equal(result.type, 'alert');
    assert.match(result.message, /Scheduler/);
    assert.match(result.message, /No se ha importado ni modificado/);
  } finally {
    clearTimeout(timeout);
    page.off('dialog', handler);
  }
}

async function saveDiagram(page, client, downloadsDirectory) {
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Ctrl+S did not download a BPMN file')); }, 15000);
    const handler = event => {
      if (event.state === 'completed') { cleanup(); resolve(event.guid); }
      if (event.state === 'canceled') { cleanup(); reject(new Error('BPMN download was canceled')); }
    };
    function cleanup() { clearTimeout(timeout); client.off('Browser.downloadProgress', handler); }
    client.on('Browser.downloadProgress', handler);
  });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Control');
  const guid = await completed;
  return fs.readFile(path.join(downloadsDirectory, guid), 'utf8');
}

async function inspectXml(page, xml) {
  return page.evaluate(xml => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const attributes = id => Object.fromEntries(
      [...document.querySelector(`[id="${id}"]`).attributes].map(attribute => [attribute.name, attribute.value])
    );
    return {
      parserError: !!document.querySelector('parsererror'),
      task: attributes('Task_smoke'),
      process: attributes('Process_smoke'),
      userTask: document.getElementsByTagNameNS('http://user', 'UserTask')[0]?.textContent,
      role: document.getElementsByTagNameNS('http://model', 'key')[0]?.textContent,
      users: document.getElementsByTagNameNS('http://model', 'value')[0]?.textContent,
      edges: document.getElementsByTagNameNS('http://www.omg.org/spec/DD/20100524/DI', 'waypoint').length
    };
  }, xml);
}

async function main() {
  assert.ok(existsSync(path.join(exampleDirectory, 'dist/modeler.js')), 'Build the web app with npm run bundle before running the smoke test.');
  const executablePath = chromePaths.find(existsSync);
  assert.ok(executablePath, 'Chrome/Chromium was not found. Set CHROME_BIN to its executable.');
  const downloadsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-smoke-'));
  const { server, baseUrl } = await serveExample();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 1000 } });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    const externalRequests = [];
    const simulationRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.origin === baseUrl || !['http:', 'https:'].includes(url.protocol)) {
        await request.continue();
        return;
      }
      if (url.href === 'http://localhost:3000/simulate') {
        const headers = { 'Access-Control-Allow-Origin': baseUrl, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
        if (request.method() === 'OPTIONS') {
          await request.respond({ status: 204, headers });
        } else if (request.method() === 'POST') {
          simulationRequests.push(JSON.parse(request.postData()));
          await request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ simulation: 'Simulation completed: 3 instances.\n<literal-result>' }) });
        } else {
          externalRequests.push(`${request.method()} ${request.url()}`);
          await request.abort();
        }
        return;
      }
      externalRequests.push(`${request.method()} ${request.url()}`);
      await request.abort();
    });

    const client = await browser.target().createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadsDirectory, eventsEnabled: true });

    await page.goto(baseUrl, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#open-local-model');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('a[href="modeler.html"]')
    ]);
    await page.waitForSelector('.djs-element[data-element-id^="StartEvent_"]');
    await page.waitForSelector('.djs-palette [data-action="create.task"]');
    assert.equal(await page.$('.djs-palette [data-action="custom-scheduler"]'), null);
    console.log('PASS: home page opens a new BPMN model without the Scheduler palette');

    const fixture = await fs.readFile(path.join(fixturesDirectory, 'smoke.bpmn'), 'utf8');
    const legacyFixture = fixture
      .replace('<bpmn:definitions ', '<bpmn:definitions xmlns:legacy="http://example.com/custom" ')
      .replaceAll('Task_smoke', 'Rejected_scheduler');
    const schedulerModels = [
      legacyFixture.replace('<bpmn:userTask ', '<bpmn:task legacy:type="scheduler" ').replace('</bpmn:userTask>', '</bpmn:task>'),
      legacyFixture.replace('<bpmn:userTask ', '<legacy:scheduler ').replace('</bpmn:userTask>', '</legacy:scheduler>')
    ];
    await page.evaluate(xml => sessionStorage.setItem('importedDiagram', xml), schedulerModels[0]);
    await expectSchedulerAlert(page, () => page.reload({ waitUntil: 'networkidle0' }));
    await page.waitForSelector('.djs-element[data-element-id^="StartEvent_"]');
    await page.waitForSelector('.djs-palette [data-action="create.task"]');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('importedDiagram')), null);
    const blankXml = await saveDiagram(page, client, downloadsDirectory);
    assert.match(blankXml, /bpmn:startEvent/);
    assert.doesNotMatch(blankXml, /Rejected_scheduler/);
    console.log('PASS: rejected Scheduler on initial load leaves a usable, saveable blank model');

    await dropDiagram(page, fixture);
    await page.waitForSelector('.djs-element[data-element-id="Task_smoke"]');
    const minimumTimeSelector = await openProperty(page, 'Task_smoke', 'Simulation parameters', 'minimumTime');
    assert.equal(await page.$eval(minimumTimeSelector, input => input.value), '2');
    await page.click(minimumTimeSelector, { clickCount: 3 });
    await page.keyboard.type('4');
    await page.keyboard.press('Tab');
    // The properties panel intentionally debounces writes by 300 ms.
    await delay(450);

    assert.equal(await page.$('input[type="file"][accept=".csv,text/csv"]'), null);
    console.log('PASS: BPMN import and simulation property editing');

    const exportedXml = await saveDiagram(page, client, downloadsDirectory);
    const exported = await inspectXml(page, exportedXml);
    assert.equal(exported.parserError, false);
    assert.equal(exported.task['user:minimumTime'], '4');
    assert.equal(exported.task['user:maximumTime'], '9');
    assert.equal(exported.task['user:NumberOfExecutions'], '2');
    assert.equal(exported.process['model:instance'], '3');
    assert.equal(exported.process['model:frequency'], '2');
    assert.equal(exported.userTask, 'Ana');
    assert.equal(exported.role, 'reviewer');
    assert.equal(exported.users, 'Ana,Luis');
    assert.equal(exported.edges, 4);

    await page.evaluate(xml => sessionStorage.setItem('importedDiagram', xml), exportedXml);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.djs-element[data-element-id="Task_smoke"]');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('importedDiagram')), null);
    const reimportedMinimumTime = await openProperty(page, 'Task_smoke', 'Simulation parameters', 'minimumTime');
    assert.equal(await page.$eval(reimportedMinimumTime, input => input.value), '4');
    const canvas = await (await page.$('#canvas')).boundingBox();
    await page.mouse.click(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.5);
    await page.waitForSelector('[data-group-id="group-model"]');
    await page.evaluate(() => {
      const header = document.querySelector('[data-group-id="group-model"] .bio-properties-panel-group-header');
      if (!header.classList.contains('open')) header.click();
    });
    await page.waitForSelector('input[placeholder="Role name"]', { visible: true });
    assert.equal(await page.$eval('input[placeholder="Role name"]', input => input.value), 'reviewer');
    assert.equal(await page.$eval('input[placeholder="User name"]', input => input.value), 'Ana,Luis');
    console.log('PASS: Ctrl+S download and reimport preserve simulation parameters, users, roles and diagram edges');

    const beforeRejectedImports = await saveDiagram(page, client, downloadsDirectory);
    for (const schedulerModel of schedulerModels) {
      await expectSchedulerAlert(page, () => dropDiagram(page, schedulerModel));
      assert.equal(await page.$('.djs-element[data-element-id="Rejected_scheduler"]'), null);
      assert.equal(await saveDiagram(page, client, downloadsDirectory), beforeRejectedImports, 'Rejecting Scheduler must preserve the entire current model');
    }
    assert.equal(simulationRequests.length, 0, 'Rejected imports must not send a simulation');
    console.log('PASS: attribute-marked and custom-element Scheduler imports warn and preserve the current model');

    await page.click('#js-simulate');
    await page.waitForSelector('.modal-overlay', { visible: true });
    assert.equal(await page.$eval('#simulation-results', element => element.textContent), 'Simulation completed: 3 instances.\n<literal-result>');
    assert.equal(await page.$('#simulation-results literal-result'), null);
    assert.equal(simulationRequests.length, 1);
    const request = simulationRequests[0];
    assert.equal(request.filename, 'esperTasks.txt');
    assert.equal(request.diagramfilename, 'diagram.bpmn');
    assert.equal('csvfilename' in request, false);
    assert.equal('csv' in request, false);
    assert.match(request.content, /id_bpmn="Task_smoke"[^\n]*minimumTime=4, maximumTime=9/);
    assert.match(request.content, /userTask="Ana"/);
    assert.match(request.content, /userWithRole=\{"reviewer": \["Ana", "Luis"\]\}/);
    assert.doesNotMatch(request.content, /type=Scheduler/);
    assert.match(request.content, /instances=3, frequency=2/);
    assert.match(request.diagramXML, /id="Task_smoke"/);
    assert.doesNotMatch(request.diagramXML, /Rejected_scheduler|custom:fileContent|custom:fileName/);
    await page.click('#close-modal');
    await page.waitForSelector('.modal-overlay', { hidden: true });
    await page.click('#js-continue');
    await page.waitForSelector('.modal-overlay', { visible: true });
    assert.equal(await page.$eval('#simulation-results', element => element.textContent), 'Simulation completed: 3 instances.\n<literal-result>');
    await page.click('#close-modal');
    await page.waitForSelector('.modal-overlay', { hidden: true });
    assert.equal(await page.$('#chatbot-input, #chatbot-selector, #send-chatbot, #heatmap-container, [data-tab="tab2"], [data-tab="tab3"]'), null);
    assert.deepEqual(await inspectXml(page, await saveDiagram(page, client, downloadsDirectory)), exported, 'Simulation must preserve the editable diagram');
    assert.deepEqual(externalRequests, [], 'The web app must not call chatbot, heatmap or external services');
    assert.deepEqual(errors, [], 'The browser must not report app errors');
    console.log('PASS: simulation-only response, results close/reopen, unchanged model and no chatbot/heatmap calls');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(downloadsDirectory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(downloadsDirectory).startsWith('modeler-smoke-'));
    await fs.rm(downloadsDirectory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
