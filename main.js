// Modules to control application life and create native browser window
const {app, BrowserWindow, protocol, dialog, Menu} = require('electron')
const path = require('path')
const url = require('url')
const child_process = require('child_process')
const http = require('http')
const https = require('https')
const os = require('os')
const fs = require('fs')
const ProgressBar = require('electron-progressbar')

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow
const HOME = os.homedir()
const InstallDir = path.join(HOME, "ImJoyAppX")


function download(url, dest) {
  return new Promise((resolve, reject)=>{
    const file = fs.createWriteStream(dest);
    const request = https.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close(resolve);  // close() is async, call cb after close completes.
      });
    }).on('error', function(err) { // Handle errors
      fs.unlink(dest); // Delete the file async. (But we don't check the result)
      reject(err.message);
    });
  })
}

function installImJoyMac(appWindow) {
  const progressBar = new ProgressBar({
    indeterminate: true,
    text: 'Installing ImJoy Plugin Engine',
    detail: 'Installing...',
    browserWindow: {parent: appWindow}
  });

  progressBar
    .on('completed', function() {
      console.info(`completed...`);
      progressBar.detail = 'Installation completed. Exiting...';
    })
    .on('aborted', function() {
      console.info(`aborted...`);
    })

    .on('progress', function(value) {
      progressBar.detail = value;
    });

  progressBar.detail = 'Checking installation directory...'
  if(fs.existsSync(InstallDir)){
     fs.renameSync(InstallDir, `${InstallDir}-${new Date().toJSON()}`, (err) => {
        if (err) {
          console.error(err);
        }
     })
  }
  fs.mkdirSync(InstallDir);

  const InstallerPath = path.join(InstallDir, 'Miniconda_Install.sh')
  progressBar.detail = 'Downloading Miniconda...'
  download("https://repo.continuum.io/miniconda/Miniconda3-latest-MacOSX-x86_64.sh", InstallerPath).then(()=>{
    progressBar.detail = 'Miniconda donwloaded.'
    const p = child_process.spawn('bash', [InstallerPath, '-b', '-f', '-p', InstallDir]);
    p.stdout.on('data',function(data){
        console.log(data.toString('utf8'));
        progressBar.detail = data.toString('utf8');
    });
    p.on('close', (code, signal) => {
      if(code == 0){
        progressBar.detail = "Installing ImJoyEngine..."
        const p2 = child_process.spawnSync('pip', ['install', 'git+https://github.com/oeway/ImJoy-Engine#egg=imjoy'], {env: {PATH: `${InstallDir}/bin`}})
        progressBar.setCompleted()
        progressBar.close()
        if(!p2.error){
          dialog.showMessageBox({title: "Installation Finished", message: "ImJoy Plugin Engine Installed."})
        }
        else{
          dialog.showErrorBox("Failled", `Failed to Install Miniconda (exit code: ${code}).`)
        }

      }
      else{
        progressBar.setCompleted()
        progressBar.close()
        dialog.showErrorBox("Failled", `Failed to Install Miniconda (exit code: ${code}).`)
      }
      if(signal){
        console.log(
          `child process terminated due to receipt of signal ${signal}`);
      }
    });

  }).catch((e)=>{
    console.error(e)
  })

}

function installImJoy(appWindow){
  installImJoyMac(appWindow)
}

function startImJoy() {
  const p = child_process.spawn('python', ['-m', 'imjoy']);
  p.stdout.on('data',function(data){
      console.log("data: ", data.toString('utf8'));
  });
}

function createWindow () {
  // Create the browser window.
  mainWindow = new BrowserWindow({icon: __dirname + '/utils/imjoy.ico'})
  // and load the index.html of the app.
  // mainWindow.loadFile('index.html')
  mainWindow.loadURL('https://imjoy.io/#/app');

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
  mainWindow.maximize()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })

  // Create the Application's main menu
  const template = [{
      label: "ImJoy",
      submenu: [
          { label: "New ImJoy Instance", click: ()=>{ let appWindow = new BrowserWindow(); appWindow.loadURL('https://imjoy.io/#/app'); appWindow.on('closed', function () {appWindow = null});}},
          { label: "About ImJoy", click: ()=>{ let aboutWindow = new BrowserWindow(); aboutWindow.loadURL('https://imjoy.io/#/about'); aboutWindow.on('closed', function () {aboutWindow = null});}},
          { type: "separator" },
          { label: "Install Plugin Engine", click: ()=>{installImJoy(mainWindow)}},
          { type: "separator" },
          { label: "Quit", accelerator: "Command+Q", click: ()=>{ app.quit(); }}
      ]}, {
      label: "Edit",
      submenu: [
          { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
          { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
          { type: "separator" },
          { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
          { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
          { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
          { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
      ]}
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', ()=>{
  createWindow()
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
