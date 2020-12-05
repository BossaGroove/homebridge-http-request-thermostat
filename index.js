let Service, Characteristic;
const packageJson = require('./package.json');
const request = require('request');
const ip = require('ip');
const http = require('http');

let globalHomebridge;

module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory('homebridge-http-request-thermostat', 'HttpThermostat', Thermostat);

	globalHomebridge = homebridge;
}

class Thermostat {
	constructor(log, config) {
		this.log = log

		this.notificationID = config.notificationID;

		this.name = config.name;
		this.slug = config.slug;
		this.pollInterval = config.pollInterval || 300;

		this.listener = config.listener || false;
		this.port = config.port || 2000;
		this.requestArray = ['targetHeatingCoolingState', 'targetTemperature', 'coolingThresholdTemperature', 'heatingThresholdTemperature'];

		this.manufacturer = config.manufacturer || packageJson.author.name;
		this.serial = config.serial || this.slug;
		this.model = config.model || packageJson.name;
		this.firmware = config.firmware || packageJson.version;

		this.request = config.request || null;

		this.setTargetHeatingCoolingStateRequest = config.setTargetHeatingCoolingStateRequest || null;
		this.setTargetTemperatureRequest = config.setTargetTemperatureRequest || null;
		this.setCoolingThresholdTemperatureRequest = config.setCoolingThresholdTemperatureRequest || null;
		this.setHeatingThresholdTemperatureRequest = config.setHeatingThresholdTemperatureRequest || null;
		this.getStatusRequest = config.getStatusRequest || null;

		this.timeout = config.timeout || 3000;

		this.temperatureThresholds = config.temperatureThresholds || false;
		this.validValues = config.validValues || null;

		this.currentRelativeHumidity = config.currentRelativeHumidity || false;
		this.temperatureDisplayUnits = config.temperatureDisplayUnits || 0;
		this.maxTemp = config.maxTemp || 30;
		this.minTemp = config.minTemp || 15;
		this.minStep = config.minStep || 0.5;

		if (this.listener) {
			this.server = http.createServer(function (request, response) {
				const baseURL = 'http://' + request.headers.host + '/';
				const url = new URL(request.url, baseURL);
				if (this.requestArray.includes(url.pathname.substr(1))) {
					this.log.debug('Handling request');
					response.end('Handling request');
					this._httpHandler(url.pathname.substr(1), url.searchParams.get('value'))
				} else {
					this.log.warn('Invalid request: %s', request.url);
					response.end('Invalid request');
				}
			}.bind(this))

			this.server.listen(this.port, function () {
				this.log('Listen server: http://%s:%s', ip.address(), this.port);
			}.bind(this))
		}

		globalHomebridge.on('didFinishLaunching', function() {
			// check if notificationRegistration is set, if not 'notificationRegistration' is probably not installed on the system
			if (global.notificationRegistration && typeof global.notificationRegistration === 'function') {
				try {
					global.notificationRegistration(this.notificationID, this.handleNotification.bind(this));
				} catch (error) {
					// notificationID is already taken
				}
			}
		}.bind(this));

		this.service = new Service.Thermostat(this.name);
	}

	handleNotification(jsonRequest) {
		const characteristic = jsonRequest.characteristic;
		const value = jsonRequest.value;

		let characteristicEnum = null;

		switch (characteristic) {
			case 'TargetTemperature':
				characteristicEnum = Characteristic.TargetTemperature;
				break;
			case 'CurrentTemperature':
				characteristicEnum = Characteristic.CurrentTemperature;
				break;
			case 'TargetHeatingCoolingState':
				characteristicEnum = Characteristic.TargetHeatingCoolingState;
				break;
			case 'CurrentHeatingCoolingState':
				characteristicEnum = Characteristic.CurrentHeatingCoolingState;
				break;
			case 'CoolingThresholdTemperature':
				characteristicEnum = Characteristic.CoolingThresholdTemperature;
				break;
			case 'HeatingThresholdTemperature':
				characteristicEnum = Characteristic.HeatingThresholdTemperature;
				break;
			case 'CurrentRelativeHumidity':
				characteristicEnum = Characteristic.CurrentRelativeHumidity;
				break;
			default:
				this.log(`Unknown characteristic when handling notification: ${characteristic}`);
				break;
		}

		this.service.getCharacteristic(characteristicEnum).updateValue(value);
	}

	identify(callback) {
		this.log('Identify requested!');
		callback();
	}

	_httpRequest(requestOptions, body, callback) {
		const options = {
			...requestOptions
		};

		options.timeout = options.timeout || this.timeout;
		options.rejectUnauthorized = false;
		options.json = true;

		if (body) {
			options.body = body;
		}

		request(options, callback);
	}

	_getStatus(callback) {
		this.log.debug('Getting status ...');

		this._httpRequest(this.getStatusRequest, null, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error getting status: %s', error.message)
				this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(new Error('Polling failed'))
				callback(error)
			} else {
				this.log.debug('Device response: %s', responseBody)
				this.service.getCharacteristic(Characteristic.TargetTemperature).updateValue(responseBody.targetTemperature)
				this.log.debug('Updated TargetTemperature to: %s', responseBody.targetTemperature)
				this.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(responseBody.currentTemperature)
				this.log.debug('Updated CurrentTemperature to: %s', responseBody.currentTemperature)
				this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(responseBody.targetHeatingCoolingState)
				this.log.debug('Updated TargetHeatingCoolingState to: %s', responseBody.targetHeatingCoolingState)
				this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(responseBody.currentHeatingCoolingState)
				this.log.debug('Updated CurrentHeatingCoolingState to: %s', responseBody.currentHeatingCoolingState)
				if (this.temperatureThresholds) {
					this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(responseBody.coolingThresholdTemperature)
					this.log.debug('Updated CoolingThresholdTemperature to: %s', responseBody.coolingThresholdTemperature)
					this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(responseBody.heatingThresholdTemperature)
					this.log.debug('Updated HeatingThresholdTemperature to: %s', responseBody.heatingThresholdTemperature)
				}
				if (this.currentRelativeHumidity) {
					this.service.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(responseBody.currentRelativeHumidity)
					this.log.debug('Updated CurrentRelativeHumidity to: %s', responseBody.currentRelativeHumidity)
				}
				callback()
			}
		}.bind(this));
	}

	_httpHandler(characteristic, value) {
		switch (characteristic) {
			case 'targetHeatingCoolingState':
				this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(value)
				this.log('Updated %s to: %s', characteristic, value)
				break
			case 'targetTemperature':
				this.service.getCharacteristic(Characteristic.TargetTemperature).updateValue(value)
				this.log('Updated %s to: %s', characteristic, value)
				break
			case 'coolingThresholdTemperature':
				this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(value)
				this.log('Updated %s to: %s', characteristic, value)
				break
			case 'heatingThresholdTemperature':
				this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(value)
				this.log('Updated %s to: %s', characteristic, value)
				break
			default:
				this.log.warn('Unknown characteristic "%s" with value "%s"', characteristic, value)
		}
	}

	setTargetHeatingCoolingState(value, callback) {
		this.log.debug('Setting targetHeatingCoolingState ...');

		this._httpRequest(this.setTargetHeatingCoolingStateRequest, {value}, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error setting targetHeatingCoolingState: %s', error.message)
				callback(error)
			} else {
				this.log('Set targetHeatingCoolingState to: %s', value)
				this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(value)
				callback()
			}
		}.bind(this));
	}

	setTargetTemperature(value, callback) {
		value = value.toFixed(1);
		this.log.debug('Setting targetTemperature ...');

		this._httpRequest(this.setTargetTemperatureRequest, {value}, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error setting targetTemperature: %s', error.message)
				callback(error)
			} else {
				this.log('Set targetTemperature to: %s', value)
				callback()
			}
		}.bind(this));
	}

	setCoolingThresholdTemperature(value, callback) {
		value = value.toFixed(1);
		this.log.debug('Setting coolingThresholdTemperature ...');

		this._httpRequest(this.setCoolingThresholdTemperatureRequest, {value}, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error setting coolingThresholdTemperature: %s', error.message)
				callback(error)
			} else {
				this.log('Set coolingThresholdTemperature to: %s', value)
				callback()
			}
		}.bind(this));
	}

	setHeatingThresholdTemperature(value, callback) {
		value = value.toFixed(1);
		this.log.debug('Setting heatingThresholdTemperature ...')

		this._httpRequest(this.setHeatingThresholdTemperatureRequest, {value}, function (error, response, responseBody) {
			if (error) {
				this.log.warn('Error setting heatingThresholdTemperature: %s', error.message)
				callback(error)
			} else {
				this.log('Set heatingThresholdTemperature to: %s', value)
				callback()
			}
		}.bind(this))
	}

	getServices() {
		this.informationService = new Service.AccessoryInformation()
		this.informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)
			.setCharacteristic(Characteristic.FirmwareRevision, this.firmware);

		this.service.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(this.temperatureDisplayUnits)

		this.service
			.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('set', this.setTargetHeatingCoolingState.bind(this))

		if (this.validValues) {
			this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
				.setProps({
					validValues: this.validValues
				});
		}

		this.service
			.getCharacteristic(Characteristic.TargetTemperature)
			.on('set', this.setTargetTemperature.bind(this))
			.setProps({
				minValue: this.minTemp,
				maxValue: this.maxTemp,
				minStep: this.minStep
			});

		if (this.temperatureThresholds) {
			this.service
				.getCharacteristic(Characteristic.CoolingThresholdTemperature)
				.on('set', this.setCoolingThresholdTemperature.bind(this))
				.setProps({
					minValue: this.minTemp,
					maxValue: this.maxTemp,
					minStep: this.minStep
				});

			this.service
				.getCharacteristic(Characteristic.HeatingThresholdTemperature)
				.on('set', this.setHeatingThresholdTemperature.bind(this))
				.setProps({
					minValue: this.minTemp,
					maxValue: this.maxTemp,
					minStep: this.minStep
				});
		}

		this._getStatus(function () {});

		setInterval(function () {
			this._getStatus(function () {})
		}.bind(this), this.pollInterval * 1000);

		return [this.informationService, this.service];
	}
}