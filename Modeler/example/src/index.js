import '../style.css';

import fileOpen from 'file-open';

document.addEventListener('DOMContentLoaded', function() {

  document.getElementById('open-local-model').addEventListener('click', async () => {
    try {
      const file = await fileOpen({
        multiple: false,
        extensions: [ '.bpmn', '.xml' ]
      });
      const xml = await file[0].contents;
      sessionStorage.setItem('importedDiagram', xml);
      window.location.href = 'modeler.html';
    } catch (err) {
      console.error('No se pudo abrir el archivo:', err);
    }
  });

});
