'use strict';

const BrowserWindow = require('electron').BrowserWindow;

// use 'extend' because 'Object.assign' doesn't work for deep copy
const extend = require('extend');

class ProgressBar {
	constructor(options, electronApp) {
		this._defaultOptions = {
			abortOnError: false,
			debug: false,
			hideButtons: true,
			hideProgress: false,
			indeterminate: true,
			initialValue: 0,
			maxValue: 100,
			closeOnComplete: true,
			title: 'Wait...',
			text: 'Wait...',
			detail: null,

			style: {
				text: {},
				detail: {},
				bar: {
					'width': '100%',
					'background': '#BBE0F1'
				},
				value: {
					'background': '#0976A9'
				}
			},

			browserWindow: {
				parent: null,
				modal: true,
				resizable: true,
				closable: true,
				minimizable: true,
				maximizable: false,
				width: 600,
				height: 450
			}
		};

		this._styleSelector = {
			determinate: {
				text: '#text',
				detail: '#detail',
				bar: '#progressBar::-webkit-progress-bar',
				value: '#progressBar::-webkit-progress-value'
			},
			indeterminate: {
				text: '#text',
				detail: '#detail',
				bar: '#progressBar[indeterminate="t"]',
				value: '#progressBar[indeterminate="t"] #progressBarValue'
			}
		};

		this._callbacks = {
			'ready': [], // list of function(){}
			'progress': [], // list of function(value){}
			'completed': [], // list of function(value){}
			'aborted': [], // list of function(value){}
			'close': [] // list of function(value){}
		};

		this._inProgress = true;
		this._options = this._parseOptions(options);
		this._realValue = this._options.initialValue;
		this._window = null;

		if (electronApp) {
			if (electronApp.isReady()) {
				this._createWindow();
			} else {
				electronApp.on('ready', () => this._createWindow.call(this));
			}
		} else {
			this._createWindow();
		}
	}

	get value() {
		return this._options.indeterminate ? null : this._realValue;
	}

	get text() {
		return this._options.text;
	}

	get detail() {
		return this._options.detail;
	}

	set title(title) {
		if (!this._window || this._window.isDestroyed()) {
			return;
		}

		this._window.setTitle(title);
	}

	set value(value) {
		if (!this._window || this._window.isDestroyed()) {
			return;
		}

		if (!this.isInProgress()) {
			return this._error('Invalid call: trying to set value but the progress bar is already completed.');
		}

		if (this._options.indeterminate) {
			return this._error('Invalid call: setting value on an indeterminate progress bar is not allowed.');
		}

		if (typeof value != 'number') {
			return this._error(`Invalid call: 'value' must be of type 'number' (type found: '` + (typeof value) + `').`);
		}

		this._realValue = Math.max(this._options.initialValue, value);
		this._realValue = Math.min(this._options.maxValue, this._realValue);

		this._window.webContents.send('SET_PROGRESS', this._realValue);

		this._updateTaskbarProgress();

		this._fire('progress', [this._realValue]);

		this._execWhenCompleted();
	}

	set text(text) {
		if (!this._window || this._window.isDestroyed()) {
			return;
		}
		this._options.text = text;
		this._window.webContents.send('SET_TEXT', text);
	}

	set detail(detail) {
		if (!this._window || this._window.isDestroyed()) {
			return;
		}
		this._options.detail = detail;
		this._window.webContents.send('SET_DETAIL', detail);
	}

	log(msg){
		if (!this._window || this._window.isDestroyed()) {
			return;
		}
		this._window.webContents.send('LOG', msg);
		console.log(msg);
	}

	error(msg){
		if (!this._window || this._window.isDestroyed()) {
			return;
		}
		this._window.webContents.send('ERROR', msg);
		console.error(msg);
	}

	getOptions() {
		return extend({}, this._options);
	}

	on(event, callback) {
		this._callbacks[event].push(callback);
		return this;
	}

	setCompleted() {
		if (!this.isInProgress()) {
			return;
		}

		this._realValue = this._options.maxValue;

		if (this._window && !this._options.indeterminate) {
			this._window.webContents.send('SET_PROGRESS', this._realValue);
		}

		this._updateTaskbarProgress();

		this._execWhenCompleted();
	}

	close() {
		if (!this._window || this._window.isDestroyed()) {
			return;
		}

		this._window.destroy();
	}

	hide() {
		if (!this._window || this._window.isDestroyed()) {
			return;
		}
		this._window.hide()
	}

	show() {
		if (!this._window || this._window.isDestroyed()) {
			return;
		}
		this._window.show()
		this._window.focus()
	}

	isInProgress() {
		return this._inProgress;
	}

	isCompleted() {
		return this._realValue >= this._options.maxValue;
	}

	_error(message) {
		if (this._options.abortOnError) {
			if (this._window && !this._window.isDestroyed()) {
				this._window && this._window.destroy();
			}

			throw Error(message);
		} else {
			console.warn(message);
		}
	}

	_fire(event, params) {
		this._callbacks[event] && this._callbacks[event].forEach(cb => {
			cb.apply(cb, params || []);
		});
	}

	_parseOptions(originalOptions) {
		let options = extend(true, {}, this._defaultOptions, originalOptions);

		if (options.indeterminate) {
			options.initialValue = 0;
			options.maxValue = 100;
		}

		if (options.title && !options.browserWindow.title) {
			options.browserWindow.title = options.title;
		}

		return options;
	}

	_parseStyle() {
		let style = [];
		let styleSelector = this._styleSelector[this._options.indeterminate ? 'indeterminate' : 'determinate'];

		Object.keys(styleSelector).forEach(el => {
			if (!styleSelector[el]) {
				return;
			}

			style.push(`${styleSelector[el]}{`);
			for (let prop in this._options.style[el]) {
				style.push(`${prop}:${this._options.style[el][prop]} !important;`);
			}
			style.push(`}`);
		});

		if (this._options.indeterminate) {
			if (this._options.style && this._options.style.value && this._options.style.value.background) {
				style.push(`
					.completed${this._styleSelector.indeterminate.bar},
					.completed${this._styleSelector.indeterminate.value}{
						background: ${this._options.style.value.background} !important;
					}
				`);
			}
		}

		return style.join('');
	}

	_createWindow() {
		if(this._options.hideButtons){
			this._options.browserWindow.height = 420;
		}
		else{
			this._options.browserWindow.height = 460;
		}
		this._window = new BrowserWindow(this._options.browserWindow);

		this._window.setMenu(null);

		if(this._options.debug){
			this._window.webContents.openDevTools({mode: 'detach'});
		}

		this._window.on('close', (event) => {
			this._fire('close', [event]);
		})

		this._window.on('closed', () => {
			this._inProgress = false;
			this._window = null;

			if (this._realValue < this._options.maxValue) {
				this._fire('aborted', [this._realValue]);
			}

			this._updateTaskbarProgress();
		});

		this._window.loadURL(`file://${__dirname}/index.html`);

		this._window.webContents.on('did-finish-load', () => {
			if (this._options.text !== null) {
				this.text = this._options.text;
			}

			if (this._options.detail !== null) {
				this.detail = this._options.detail;
			}

			this._window.webContents.insertCSS(this._parseStyle());

			if (this._options.maxValue !== null) {
				this._window.webContents.send('CREATE_PROGRESS_BAR', {
					hideButtons: this._options.hideButtons,
					indeterminate: this._options.indeterminate,
					hideProgress: this._options.hideProgress,
					maxValue: this._options.maxValue
				});
			}

			this._fire('ready');
		});

		this._updateTaskbarProgress();
	}

	_updateTaskbarProgress() {
		// TODO: disable it for now
		return

		let mainWindow;

		if (this._options.browserWindow && this._options.browserWindow.parent) {
			mainWindow = this._options.browserWindow.parent;
		} else {
			mainWindow = this._window;
		}

		if (!mainWindow || mainWindow.isDestroyed()) {
			return;
		}

		if (!this.isInProgress() || this.isCompleted()) {
			// remove the progress bar from taskbar
			return mainWindow.setProgressBar(-1);
		}

		if (this._options.indeterminate) {
			// any number above 1 turns the taskbar's progress bar indeterminate
			mainWindow.setProgressBar(9);
		} else {
			const percentage = (this.value * 100) / this._options.maxValue;

			// taskbar's progress bar must be a number between 0 and 1, e.g.:
			// 63% should be 0.63, 99% should be 0.99...
			const taskbarProgressValue = percentage / 100;

			mainWindow.setProgressBar(taskbarProgressValue);
		}
	}

	_execWhenCompleted() {
		if (!this.isInProgress() || !this.isCompleted() || !this._window || !this._window.webContents) {
			return;
		}

		this._inProgress = false;

		this._window.webContents.send('SET_COMPLETED');

		this._updateTaskbarProgress();

		this._fire('completed', [this._realValue]);

		if (this._options.closeOnComplete) {
			var delayToFinishAnimation = 500;
			setTimeout(() => this.close(), delayToFinishAnimation);
		}
	}
}

module.exports = ProgressBar;
