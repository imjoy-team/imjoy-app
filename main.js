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
const EngineDialog = require('./asserts/engine_dialog')
let engineDialog = null
let engineProcess = null
let welcomeDialog = null

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
const appWindows = []
const HOME = os.homedir()
const InstallDir = path.join(HOME, "ImJoyApp")
const processes = []
let processEndCallback = null
let engineEndCallback = null
let serverEnabled = false
let engineExiting = false

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
    let backlog_out = ''
    p.stdout.on('data',function(data){
      backlog_out += data.toString('utf8')
      let n = backlog_out.indexOf('\n')
      if(backlog_out.length>256){
        n = backlog_out.length
      }
      // got a \n? emit one or more 'line' events
      while (~n) {
        ed.log(backlog_out.substring(0, n));
        backlog_out = backlog_out.substring(n + 1)
        n = backlog_out.indexOf('\n')
      }
    });
    let backlog_err = ''
    p.stderr.on('data',function(data){
      backlog_err += data.toString('utf8')
      let n = backlog_err.indexOf('\n')
      if(backlog_err.length>256){
        n = backlog_err.length
      }
      // got a \n? emit one or more 'line' events
      while (~n) {
        ed.error(backlog_err.substring(0, n));
        backlog_err = backlog_err.substring(n + 1)
        n = backlog_err.indexOf('\n')
      }
    });
    p.on('close', (code, signal) => {
      backlog_out = null
      backlog_err = null
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
      if(processes.length <= 0){
        if(processEndCallback) processEndCallback()
      }
    })
  })
}

ipcMain.on('START_CMD', (event, arg) => {
  if(arg.start_app){
    createWindow('/#/app')
  }
  else if(arg.start_engine){
    startImJoyEngine()
  }
  else if(arg.run_offline){
    switchToOffline()
  }
  else{
    console.log("unsupported command", arg)
  }

  if(arg.close_welcome){
    if(welcomeDialog){
      welcomeDialog.close()
      welcomeDialog = null
    }
  }

})

ipcMain.on('UPDATE_ENGINE_DIALOG', (event, arg) => {
  if(!engineDialog) {
    console.log('event received, but engine dialog closed.', arg)
    return;
  }

  // if(arg.show){
  //   engineDialog.show()
  //   event.sender.send('ENGINE_DIALOG_RESULT', {success: true, show: true})
  // }
  // else if(arg.exit){
  //   try {
  //     engineExiting = true
  //     terminateImJoyEngine()
  //     event.sender.send('ENGINE_DIALOG_RESULT', {success: true, stop: true})
  //   } catch (e) {
  //     event.sender.send('ENGINE_DIALOG_RESULT', {error: true, stop: true})
  //   }
  // }
  // else if(arg.hide){
  //   engineDialog.hide()
  //   event.sender.send('ENGINE_DIALOG_RESULT', {success: true, hide: true})
  // }
})

function initEngineDialog(config){
  const ed = new EngineDialog({
    hideButtons: config && config.hideButtons,
    indeterminate: true,
    text: 'ImJoy Plugin Engine',
    detail: '',
    title: 'ImJoy Plugin Engine',
    browserWindow: config && config.appWindow && {parent: config.appWindow}
  });

  ed.on('completed', function() {
    console.info(`completed...`);
  })
  .on('aborted', function() {
    console.info(`aborted...`);
    engineDialog = null
  })

  .on('progress', function(value) {
    ed.log(value);
  })

  .on('close', function(event) {
    if(engineProcess){
      event.preventDefault()
      const dialogOptions = {type: 'info', buttons: ['Yes, terminate it', 'Cancel'], message: 'Are you sure to terminate the Plugin Engine?'}
      dialog.showMessageBox(dialogOptions, (choice) => {
        if(choice == 0){
          try {
            engineExiting = true
            terminateImJoyEngine()
            event.sender.send('ENGINE_DIALOG_RESULT', {success: true, stop: true})
          } catch (e) {
            event.sender.send('ENGINE_DIALOG_RESULT', {error: true, stop: true})
          }
        }
      })
    }
  });

  ed.hide()
  engineDialog = ed
  return ed
}

function checkOldInstallation(){
  return new Promise((resolve, reject)=>{
    if(fs.existsSync(InstallDir)){
        const dateStr = new Date().toJSON()
        const dialogOptions = {type: 'info', buttons: ['Yes, reinstall it', 'Cancel'], message: `Found existing ImJoy Plugin Engine in ~/ImJoyApp folder, are you sure to remove it and start a new installation?`}
        dialog.showMessageBox(dialogOptions, (choice) => {
          if(choice == 0){
            fs.renameSync(InstallDir, `${InstallDir}-${dateStr}`, (err) => {
               if (err) {
                 console.error(err);
               }
            })
            resolve()
          }
          else{
            console.log('installation is canceled by the user.')
            reject()
          }
        })
    }
    else{
      resolve()
    }
  })
}

function installImJoyEngine(appWindow) {
  return new Promise((resolve, reject)=>{
    checkOldInstallation().then(()=>{
      const ed = initEngineDialog({appWindow: appWindow})
      ed.show()
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
      ed.on('close', function(event) {
        event.preventDefault()
      })
      runCmds().then(()=>{
        dialog.showMessageBox({title: "Installation Finished", message: "ImJoy Plugin Engine Installed."})
        resolve()
      }).catch((e)=>{
        dialog.showErrorBox("Failed to Install the Plugin Engine", e + " You may want to try again or reinstall the Plugin Engine.")
        reject()
      }).finally(()=>{
        // ed.hide()
        ed.setCompleted()
        ed.close()
      })
    }).catch(reject)
  })
}

function startImJoyEngine(appWindow) {
  if(!engineDialog || engineDialog.isCompleted()){
    engineDialog = initEngineDialog()
  }
  engineDialog.show()
  if(engineProcess) return;
  if(checkEngineExists()){
    const args = ['-m', 'imjoy']
    if(serverEnabled){
      args.push('--serve')
    }
    engineEndCallback = null
    engineExiting = false
    executeCmd("ImJoy Plugin Engine", "python", args, engineDialog, (p)=>{ engineProcess = p }).catch((e)=>{
      console.error(e)
      engineProcess = null
      if(!engineExiting){
        dialog.showMessageBox({title: "Plugin Engine Exited", message: e})
      }
    }).finally(()=>{
      engineProcess = null
      if(engineDialog && engineExiting){
        engineDialog.setCompleted()
        engineDialog.close()
        engineDialog = null
      }
      if(engineEndCallback){
        engineEndCallback()
      }
    })
  }
  else{
    const dialogOptions = {type: 'info', buttons: ['Install', 'Cancel'], message: 'Plugin Engine not found! Would you like to setup Plugin Engine? This may take a while.'}
    dialog.showMessageBox(dialogOptions, (choice) => {
      if(choice == 0){
        installImJoyEngine(appWindow).then(()=>{
          startImJoyEngine(appWindow)
        })
      }
    })
  }
}

function terminateImJoyEngine(){
  if(engineProcess){
    engineProcess.kill()
  }
  for(let p of processes){
    p.kill()
  }
  serverEnabled = false
  engineExiting = true
}

function setAppMenu(mainWindow){
  // Create the Application's main menu
  const template = [{
      label: "ImJoy",
      submenu: [
          { label: "About ImJoy", click: ()=>{ createWindow('/#/about') }},
          { label: "Welcome Dialog", accelerator: "CmdOrCtrl+W", click: ()=>{ createWelcomeDialog() }},
          { type: "separator" },
          { label: "Reload", accelerator: "CmdOrCtrl+R", click: ()=>{ if(mainWindow && !mainWindow.closed) mainWindow.reload() }},
          { label: "New ImJoy Instance", accelerator: "CmdOrCtrl+N", click: ()=>{ createWindow('/#/app') }},
          { type: "separator" },
          { label: "Switch to offline mode", click: ()=>{ switchToOffline()}},
          { type: "separator" },
          { label: "Quit", accelerator: "Command+Q", click: ()=>{
            app.quit(); }}
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
      ]}, {
      label: "ImJoyEngine",
      submenu: [
        { label: "Start Plugin Engine", accelerator: "CmdOrCtrl+E", click: ()=>{startImJoyEngine(mainWindow)}},
        { label: "Hide Engine Dialog", accelerator: "CmdOrCtrl+H", click: ()=>{ if(engineDialog) engineDialog.hide() }},
        { type: "separator" },
        { label: "Install Plugin Engine", click: ()=>{
          installImJoyEngine(mainWindow).then(()=>{
            startImJoyEngine(mainWindow)
          })
        }},
      ]}, {
      label: "Help",
      submenu: [
        { label: "ImJoy Docs", click: ()=>{ createWindow('/docs') }}
      ]}
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function switchToOffline(mainWindow){
  serverEnabled = true;
  const startEngine = ()=>{
    startImJoyEngine(mainWindow);
    setTimeout(()=>{
      if(engineProcess){
        dialog.showMessageBox({title: "Offline mode.", message: "Plugin Engine is running, you may need to refresh the window to see the ImJoy app."})
        createWindow('/#/app');
      }
      else{
        dialog.showMessageBox({title: "Failed to start.", message: "ImJoy Plugin Engine failed to start."})
      }
    }, 5000)
  }
  if(mainWindow && !mainWindow.closed) mainWindow.close();
  if(engineDialog) engineDialog.show();
  if(engineProcess){
    engineEndCallback = startEngine
    terminateImJoyEngine()
  }
  else{
    startEngine()
  }
}

function createWelcomeDialog () {
  // Create the browser window.
  const wd = new BrowserWindow({icon: __dirname + '/asserts/imjoy.ico',
    title: "Welcome",
    parent: null,
    modal: true,
    resizable: false,
    closable: true,
    minimizable: true,
    maximizable: false,
    width: 600,
    height: 360,
    // webPreferences: {
    //     nodeIntegration: false,
    //     preload: path.join(__dirname, 'asserts', 'preload.js')
    // }
  })
  wd.loadURL(`file://${__dirname}/asserts/welcome_dialog.html`);
  wd.on('closed', () => {
      welcomeDialog = null
  })
  if(welcomeDialog) {
    welcomeDialog.close()
  }
  welcomeDialog = wd
}

function createWindow (route_path) {
  let serverUrl = 'https://imjoy.io';
  if(serverEnabled){
    serverUrl = 'http://127.0.0.1:8080'
  }
  // Create the browser window.
  let mainWindow = new BrowserWindow({icon: __dirname + '/asserts/imjoy.ico',
    title: `ImJoy App (${serverUrl})`,
    width: 1024,
    height: 768,
    webPreferences: {
        nodeIntegration: false,
        preload: path.join(__dirname, 'asserts', 'preload.js')
    }
  })
  // and load the index.html of the app.
  // mainWindow.loadFile('index.html')
  mainWindow.loadURL(serverUrl+route_path);

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
  // mainWindow.maximize()

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
  setAppMenu(mainWindow)
  appWindows.push(mainWindow)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', ()=>{
  setAppMenu()
  processEndCallback = null
  // createWindow('/#/app')
  createWelcomeDialog()
})

app.on('before-quit', (event) => {
  if(processes.length > 0){
    terminateImJoyEngine()
    processEndCallback = app.quit
    event.preventDefault();
  }
})
// app.on('quit', ()=>{
//
// })

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  // if (process.platform !== 'darwin') {
  // app.quit()
  // }
  app.quit()
})

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (appWindows.length <= 0) {
    // createWindow('/#/app')
    if(engineDialog) engineDialog.show()
    else createWelcomeDialog()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
