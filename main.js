'use strict';
// Modules to control application life and create native browser window
const {app, BrowserWindow, protocol, dialog, Menu, ipcMain} = require('electron')
const path = require('path')
const url = require('url')
const child_process = require('child_process')
const http = require('http')
const https = require('https')
const os = require('os')
const fs = require('fs')
const EngineDialog = require('./imjoy_engine_dialog')
let engineDialog = null
let engineProcess = null

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
const appWindows = []
const HOME = os.homedir()
const InstallDir = path.join(HOME, "ImJoyAppX")
const processes = []
process.env.PATH = process.platform !== "win32" ? `${InstallDir}${path.sep}bin${path.delimiter}${process.env.PATH}` :
`${InstallDir}${path.delimiter}${InstallDir}${path.sep}Scripts${path.delimiter}${process.env.PATH}`;

const replace_user_site = `
import site
site_file = site.__file__.replace('.pyc', '.py');
with open(site_file) as fin:
    lines = fin.readlines();
for i,line in enumerate(lines):
    if(line.find('ENABLE_USER_SITE = None') > -1):
        user_site_line = i;
        break;
lines[user_site_line] = 'ENABLE_USER_SITE = False\\n'
with open(site_file,'w') as fout:
    fout.writelines(lines)
print('User site replaced.')
`
function checkEngineExists(){
  if(fs.existsSync(InstallDir)){
    const p = child_process.spawnSync('python', ['-c', '"import imjoy"']);
    if(p.status == 0){
      return true
    }
    else{
      return false
    }
  }
  else{
    return false
  }
}
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

function executeCmd(label, cmd, param, ed, callback) {
  ed = ed || engineDialog
  return new Promise((resolve, reject)=>{
    ed.text = label
    const p = child_process.spawn(cmd, param);
    if(callback) callback(p);
    processes.push(p)
    p.stdout.on('data',function(data){
        ed.log(data.toString('utf8'));
    });
    p.stderr.on('data',function(data){
        ed.error(data.toString('utf8'));
    });
    p.on('close', (code, signal) => {
      //remove the process
      const index = processes.indexOf(p);
      if (index > -1) {
        processes.splice(index, 1);
      }
      if(code === null || code == 0){
        ed.log(`${label}: Done.`)
        resolve(`${label}: Done.`)
      }
      else{
        ed.log(`Process '${label}' exited with code: ${code})`)
        reject(`Process '${label}' exited with code: ${code})`)
      }
    })
  })
}

ipcMain.on('UPDATE_ENGINE_DIALOG', (event, arg) => {
  if(arg.show){
    engineDialog.show()
    event.sender.send('ENGINE_DIALOG_RESULT', {success: true, show: true})
  }
  else if(arg.exit){
    try {
      for(let p of processes){
        p.kill()
      }
      event.sender.send('ENGINE_DIALOG_RESULT', {success: true, stop: true})
    } catch (e) {
      event.sender.send('ENGINE_DIALOG_RESULT', {error: true, stop: true})
    }
  }
  else if(arg.hide){
    engineDialog.hide()
    event.sender.send('ENGINE_DIALOG_RESULT', {success: true, hide: true})
  }
})

function initEngineDialog(appWindow){
  const ed = new EngineDialog({
    indeterminate: true,
    text: 'ImJoy Plugin Engine',
    detail: '',
    title: 'ImJoy Plugin Engine',
    browserWindow: appWindow && {parent: appWindow}
  });

  ed.on('completed', function() {
    console.info(`completed...`);
  })
  .on('aborted', function() {
    console.info(`aborted...`);
  })

  .on('progress', function(value) {
    ed.log(value);
  });
  return ed
}

function installImJoyEngine(ed) {
  return new Promise((resolve, reject)=>{
    ed.log('Checking installation directory...')
    if(fs.existsSync(InstallDir)){
       fs.renameSync(InstallDir, `${InstallDir}-${new Date().toJSON()}`, (err) => {
          if (err) {
            console.error(err);
          }
       })
    }
    fs.mkdirSync(InstallDir);

    const cmds = [
      ['Replace User Site', 'python', ['-c', replace_user_site]],
      ['Install Git', 'conda', ['install', '-y', 'git']],
      ['Upgrade PIP', 'pip', ['install', '-U', 'pip']],
      ['Install ImJoy', 'pip', ['install', '-U', 'git+https://github.com/oeway/ImJoy-Engine#egg=imjoy']],
    ]

    const runCmds = async ()=>{
      if(process.platform === 'darwin'){
        const InstallerPath = path.join(InstallDir, 'Miniconda_Install.sh')
        ed.log('Downloading Miniconda...')
        await download("https://repo.continuum.io/miniconda/Miniconda3-latest-MacOSX-x86_64.sh", InstallerPath)
        ed.log('Miniconda donwloaded.')
        cmds.unshift(['Install Miniconda', 'bash', [InstallerPath, '-b', '-f', '-p', InstallDir]])
      }
      else if(process.platform === 'linux'){
        const InstallerPath = path.join(InstallDir, 'Miniconda_Install.sh')
        ed.log('Downloading Miniconda...')
        await download("https://repo.continuum.io/miniconda/Miniconda3-latest-Linux-x86_64.sh", InstallerPath)
        ed.log('Miniconda donwloaded.')
        cmds.unshift(['Install Miniconda', 'bash', [InstallerPath, '-b', '-f', '-p', InstallDir]])
      }
      else if(process.platform === 'win32'){
        const InstallerPath = path.join(InstallDir, 'Miniconda_Install.exe')
        ed.log('Downloading Miniconda...')
        await download("https://repo.continuum.io/miniconda/Miniconda3-latest-Windows-x86_64.exe", InstallerPath)
        ed.log('Miniconda donwloaded.')
        cmds.unshift(['Install Miniconda', InstallerPath, ['/S', '/AddToPath=0', '/D='+InstallDir]])
      }
      else{
        throw "Unsupported Platform: " + process.platform
      }

      for(let cmd of cmds){
        try {
          await executeCmd(cmd[0], cmd[1], cmd[2], ed)
        } catch (e) {
          throw e
        }
      }
    }

    runCmds().then(()=>{
      dialog.showMessageBox({title: "Installation Finished", message: "ImJoy Plugin Engine Installed."})
      resolve()
    }).catch((e)=>{
      dialog.showErrorBox("Failed to Install the Plugin Engine", e)
      reject()
    }).finally(()=>{
      // ed.hide()
      ed.setCompleted()
      ed.close()
    })
  })
}

function startImJoyEngine(appWindow) {
  engineDialog.show()
  if(engineProcess) return;
  if(checkEngineExists()){
    executeCmd("ImJoy Plugin Engine", "python", ['-m', 'imjoy'], engineDialog, (p)=>{ engineProcess = p }).catch((e)=>{
      console.error(e)
      dialog.showMessageBox({title: "Plugin Engine Exited", message: "Plugin Engine Exited"})
    }).finally(()=>{
      engineDialog.hide()
      engineProcess = null
    })
  }
  else{
    const dialogOptions = {type: 'info', buttons: ['Install', 'Cancel'], message: 'Plugin Engine not found! Would you like to setup Plugin Engine? This may take a while.'}
    dialog.showMessageBox(dialogOptions, (choice) => {
      if(choice == 0){
        const ed = initEngineDialog(appWindow)
        installImJoyEngine(ed).then(()=>{
          startImJoyEngine(appWindow)
        })
      }
    })
  }
}

function createWindow (url) {
  if(engineDialog && !engineDialog.isCompleted()){
    engineDialog.show()
  }
  else{
    engineDialog = initEngineDialog()
  }
  // Create the browser window.
  let mainWindow = new BrowserWindow({icon: __dirname + '/utils/imjoy.ico',
    webPreferences: {
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js')
    }
  })
  // and load the index.html of the app.
  // mainWindow.loadFile('index.html')
  mainWindow.loadURL(url);

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
  mainWindow.maximize()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    const index = appWindows.indexOf(mainWindow);
    if (index > -1) {
      appWindows.splice(index, 1);
    }
    mainWindow = null
  })

  appWindows.push(mainWindow)
  // Create the Application's main menu
  const template = [{
      label: "ImJoy",
      submenu: [
          { label: "New ImJoy Instance", click: ()=>{ createWindow('https://imjoy.io/#/app') }},
          { label: "About ImJoy", click: ()=>{ createWindow('https://imjoy.io/#/about') }},
          { type: "separator" },
          { label: "Install ImJoy Plugin Engine", click: ()=>{const ed = initEngineDialog(mainWindow); installImJoyEngine(ed)}},
          { label: "ImJoy Plugin Engine", accelerator: "CmdOrCtrl+I", click: ()=>{startImJoyEngine(mainWindow)}},
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
  createWindow('https://imjoy.io/#/app')
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }

  if(processes.length>0){
    try {
      console.log(`killing ${processes.length} processes...`)
      for(let p of processes){
        p.kill()
      }
    } catch (e) {
      console.error('error occured when killing porcesses')
    }
  }

})

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (appWindows.length <= 0) {
    createWindow('https://imjoy.io/#/app')
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
