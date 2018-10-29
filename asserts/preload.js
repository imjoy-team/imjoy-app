// in preload scripts, we have access to node.js and electron APIs
// the remote web app will not have access, so this is safe
const { ipcRenderer: ipc, remote } = require('electron');

init();

function updateEngineDialog(config) {
  ipc.send('UPDATE_ENGINE_DIALOG', config)
}

function init() {
  // Expose a bridging API to by setting an global on `window`.
  // We'll add methods to it here first, and when the remote web app loads,
  // it'll add some additional methods as well.
  //
  // !CAREFUL! do not expose any functionality or APIs that could compromise the
  // user's computer. E.g. don't directly expose core Electron (even IPC) or node.js modules.
  window.ImJoyAppApi = {
    updateEngineDialog: updateEngineDialog
  };

  ipc.on('ENGINE_DIALOG_RESULT', (event, arg) => {
    if(arg.success){
      if(arg.show){
        console.log('show engine dialog success')
      }
      else if(arg.hide){
        console.log('hide engine dialog success')
      }
      else{
        console.log(arg)
      }
    }
  })
  // we get this message from the main process
  // ipc.on('markAllComplete', () => {
  // });
}
