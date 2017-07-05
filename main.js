/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
var utils        = require(__dirname + '/lib/utils'); // Get common adapter utils
var rfxcom       = require('rfxcom');
var RTY          = require(__dirname + '/lib/rty');

var adapter      = utils.adapter('rfxcom');
var channels     = {};

var inclusionOn  = false;
var inclusionTimeout = false;
var lastReceived = {};
var repairInterval = null;
var connection   = null;
var comm;
var rtyDevices   = {};

adapter.on('message', function (obj) {
    if (obj) {
        switch (obj.command) {
            case 'listUart':
                if (obj.callback) {
                    try {
                        var serialport = require('serialport');
                        if (serialport) {
                            // read all found serial ports
                            serialport.list(function (err, ports) {
                                adapter.log.info('List of port: ' + JSON.stringify(ports));
                                adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                            });
                        } else {
                            adapter.log.warn('Module serialport is not available');
                            adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                        }
                    } catch (e) {
                        adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                    }
                }

                break;

            case 'program':
                // find or create device with such DeviceID
                if (obj.message) {
                    var id = adapter.namespace + '.' + (obj.message.type || 'rty') + '.' + obj.message.deviceId + '_' + obj.message.unitCode;
                    if (rtyDevices[id]) {
                        rtyDevices[id].program(function (err) {
                            if (err) {
                                adapter.log.error('Cannot program "' + id + '": ' + err);
                            }
                            if (obj.callback) {
                                adapter.sendTo(obj.from, obj.command, [{result: err}], obj.callback);
                            }
                        });
                    } else {
                        if (obj.message.type === 'RTY') {
                            // create device
                            var device = new RTY(comm, {
                                deviceId: obj.message.deviceId + '/' + obj.message.unitCode,
                                subtype:  obj.message.subtype
                            }, adapter.log);

                            device.program(function(err) {
                                if (err) {
                                    adapter.log.error('Cannot program "' + id + '": ' + err);
                                }
                                if (obj.callback) {
                                    adapter.sendTo(obj.from, obj.command, [{result: err}], obj.callback);
                                }
                            });
                            device = null;
                        }
                    }
                }
                break;

            default:
                adapter.log.error('Unknown command: ' + obj.command);
                break;
        }
    }
});

function setConnState(isConnected) {
    if (isConnected !== connection) {
        connection = isConnected;
        console.log.info('State: ' + isConnected ? 'connected' : 'disconnected');

        adapter.setState('info.connection', isConnected, true);
    }
}

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    setConnState(false);
    try {
        if (repairInterval) {
            clearInterval(repairInterval);
            repairInterval = null;
        }

        if (comm) {
            comm.close();
            comm.removeAllListeners();
        }
        comm = null;
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    if (!state || state.ack || !comm) return;

    var parts = id.split('.');
    var command = parts.pop();
    var channel = parts.join('.');

    if (!channels[channel] || !channels[channel].device) {
        adapter.log.warn('Unknown device "' + channel + '"');
    } else if (channels[channel].device.commands.indexOf(command) === -1) {
        adapter.log.warn('Unknown command "' + command + '" for "' + channel + '"');
    } else {
        channels[channel].device.sendCommand(command, function (err) {
            if (err) {
                adapter.log.error('Cannot control "' + command + '" for "' + channel + '": ' + err);
            } else {
                adapter.setForeignState(id, false, true);
            }
        });
    }
});

adapter.on('objectChange', function (id, obj) {
    if (!obj) {
        if (channels[id])     delete channels[id];
        if (states[id])       delete states[id];
        if (lastReceived[id]) delete lastReceived[id];
    } else {
        if (obj.type === 'state') {
            states[id] = obj;
        } else if (obj.type === 'channel') {
            //if (obj.native.autoRepair !== undefined) obj.native.autoRepair = parseInt(obj.native.autoRepair, 10) || 0;

            if (obj.native.autoRepair) {
                lastReceived[id] = new Date().getTime();
            } else if (lastReceived[id]) {
                delete lastReceived[id];
            }

            channels[id] = obj;
        }
    }
});

adapter.on('ready', function () {
    main();
});

function setInclusionState(val) {
    val = val === 'true' || val === true || val === 1 || val === '1';
    inclusionOn = val;

    if (inclusionTimeout) clearTimeout(inclusionTimeout);
    inclusionTimeout = null;

    if (inclusionOn && adapter.config.inclusionTimeout) {
        inclusionTimeout = setTimeout(function () {
            inclusionOn = false;
            adapter.setState('inclusionOn', false, true);
        }, adapter.config.inclusionTimeout);
    }
}

var supportedEvents = {
    security1:  processEvents, // Emitted when an X10 or similar security device reports a status change.
    bbq1:       processSensors, // Emitted when a message is received from a Maverick ET-732 BBQ temperature sensor.
    temprain1:  processSensors, // Emitted when a message is received from an Allecto temperature/rainfall weather sensor.
    temp1:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp2:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp3:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp4:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp5:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp6:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp7:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp8:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp9:      processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp10:     processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    temp11:     processSensors, // Emitted when a message is received from a temperature sensor (inside/outside air temperature; pool water temperature).
    humidity1:  processSensors, // Emitted when data arrives from humidity sensing devices
    th1:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th2:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th3:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th4:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th5:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th6:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th7:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th8:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th9:        processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th10:       processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th12:       processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th13:       processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    th14:       processSensors, // Emitted when a message is received from Oregon Scientific and other temperature/humidity sensors.
    thb1:       processSensors, // Emitted when a message is received from an Oregon Scientific temperature/humidity/barometric pressure sensor.
    thb2:       processSensors, // Emitted when a message is received from an Oregon Scientific temperature/humidity/barometric pressure sensor.
    rain1:      processSensors, // Emitted when data arrives from rainfall sensing devices
    rain2:      processSensors, // Emitted when data arrives from rainfall sensing devices
    rain3:      processSensors, // Emitted when data arrives from rainfall sensing devices
    rain4:      processSensors, // Emitted when data arrives from rainfall sensing devices
    rain5:      processSensors, // Emitted when data arrives from rainfall sensing devices
    rain6:      processSensors, // Emitted when data arrives from rainfall sensing devices
    rain7:      processSensors, // Emitted when data arrives from rainfall sensing devices
    wind1:      processSensors, // Emitted when data arrives from wind speed/direction sensors
    wind2:      processSensors, // Emitted when data arrives from wind speed/direction sensors
    wind3:      processSensors, // Emitted when data arrives from wind speed/direction sensors
    wind4:      processSensors, // Emitted when data arrives from wind speed/direction sensors
    wind5:      processSensors, // Emitted when data arrives from wind speed/direction sensors
    wind6:      processSensors, // Emitted when data arrives from wind speed/direction sensors
    wind7:      processSensors, // Emitted when data arrives from wind speed/direction sensors
    uv1:        processSensors, // Emiied when data arrives from ultraviolet radiation sensors
    uv2:        processSensors, // Emiied when data arrives from ultraviolet radiation sensors
    uv3:        processSensors, // Emiied when data arrives from ultraviolet radiation sensors
    weight1:    processSensors, // Emitted when a message is received from a weighing scale device.
    weight2:    processSensors, // Emitted when a message is received from a weighing scale device.
    elec1:      processEnergy, // Emitted when data is received from OWL or REVOLT electricity monitoring devices.
    elec2:      processEnergy, // Emitted when data is received from OWL or REVOLT electricity monitoring devices.
    elec3:      processEnergy, // Emitted when data is received from OWL or REVOLT electricity monitoring devices.
    elec4:      processEnergy, // Emitted when data is received from OWL or REVOLT electricity monitoring devices.
    elec5:      processEnergy, // Emitted when data is received from OWL or REVOLT electricity monitoring devices.
    rfxmeter:   processEvents, // Emitted whan a message is received from an RFXCOM rfxmeter device.
    rfxsensor:  processEvents, // Emitted when a message is received from an RFXCOM rfxsensor device.
    lighting1:  processLighting1, // Emitted when a message is received from X10, ARC, Energenie or similar lighting remote control devices.
    lighting2:  processLighting2, // Emitted when a message is received from AC/HomeEasy type remote control devices.
    lighting3:  processEvents, // ??
    lighting4:  processLighting4, // Emitted when a message is received from devices using the PT2262 family chipset.
    lighting5:  processLighting5, // Emitted when a message is received from LightwaveRF/Siemens type remote control devices.
    lighting6:  processLighting6, // Emitted when a message is received from Blyss lighting remote control devices.
    blinds1:    processBlinds, // Emitted when a message arrives from a compatible type 1 blinds remote controller (only a few subtypes can be received)
    chime1:     processEvents // Emitted when data arrives from Byron or similar doorbell pushbutton
};

function processEvents(event, data) {
    // evt.rssi
    // evt.housecode
    // evt.commandNumber
    // evt.unitcode

    // evt.temperature "°C"
    // evt.barometer "hPa"
    // evt.direction "°"
    // evt.averageSpeed "m/s"
    // evt.averageSpeed "m/s"
    // evt.gustSpeed "m/s"
    // evt.chillfactor "°C"
    // evt.humidity "%"
    // evt.rainfall "mm"
    // evt.rainfallRate "mm/hr"
    // evt.rainfallIncrement "mm"
    // evt.uv "UVIndex"
    // evt.forecast

    if (event === 'lighting1')


    adapter.log.debug('[' + event + ']: ' + JSON.stringify(data));
}

function processLighting1(event, data) {
    // evt.rssi
    // evt.housecode
    // evt.commandNumber
    // evt.unitcode

    var val = false;
    switch (data.commandNumber) {
        case 0:
        case 5:
            val = false;
            break;

        case 1:
        case 6:
            val = true;
            break;

        case 2:
            val = "Dim";
            break;

        case 3:
            val = "Bright";
            break;

        case 7:    // ignore it here => doorbell
            return;

        default:
            adapter.log.warn("Unrecognised Lighting1 command " + data.commandNumber.toString(16));
            return;
    }

}

function processLighting2(event, data) {
    // data.rssi
    // data.housecode
    // data.commandNumber
    // data.unitcode
    // data.subtype

    var val = false;
    switch (data.commandNumber) {
        case 0:
        case 3:
            val = false;
            break;

        case 1:
        case 4:
            val = true;
            break;

        case 2:
        case 5:
            val = data.level / 15 * 100;
            break;

        default:
            adapter.log.warn("Unrecognised Lighting2 command " + data.commandNumber.toString(16));
            return;
    }

}

function processLighting5(event, data) {
    // data.rssi
    // data.housecode
    // data.commandNumber
    // data.unitcode
    // data.subtype

    var val = false;
    switch (data.subtype) {
        case 0: // Lightwave RF
            switch (data.commandNumber) {
                case 0:
                case 2:
                    val = false;
                    break;

                case 1:
                    val = true;
                    break;

                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                    msg.payload = "Mood" + (evt.commandNumber - 2);
                    break;

                case 16:
                    val = data.level / 31 * 100;
                    break;

                case 17:
                case 18:
                case 19:
                    adapter.log.warn("Unrecognised Lighting5 LightwaveRF command " + data.commandNumber.toString(16));
                    break;

                default:
                    return;
            }
            break;

        case 2:
        case 4: // BBSB & CONRAD
            switch (data.commandNumber) {
                case 0:
                case 2:
                    val = false;
                    break;

                case 1:
                case 3:
                    val = true;
                    break;

                default:
                    return;
            }
            break;

        case 6: // TRC02
            switch (data.commandNumber) {
                case 0:
                    val = false;
                    break;

                case 1:
                    val = true;
                    break;

                case 2:
                    val = "Bright";
                    break;

                case 3:
                    val = "Dim";
                    break;

                default:
                    adapter.log.warn("Unrecognised Lighting5 TRC02 command " + data.commandNumber.toString(16));
                    return;
            }
            break;
    }

}

function processLighting6(event, data) {
    // data.rssi
    // data.housecode
    // data.commandNumber
    // data.unitcode
    // data.subtype

    var val = false;
    switch (data.commandNumber) {
        case 1:
        case 3:
            val = false;
            break;

        case 0:
        case 2:
            val = true;
            break;

        default:
            adapter.log.warn("Unrecognised Lighting6 command " + data.commandNumber.toString(16));
            return;
    }
}

// PT622
function processLighting4(event, data) {
    adapter.log.warn("Unrecognised Lighting4 command " + JSON.stringify(data));
}

function processSensors(event, data) {
    // evt.rssi
    // evt.housecode
    // evt.commandNumber
    // evt.unitcode

    // evt.temperature "°C"
    // evt.barometer "hPa"
    // evt.direction "°"
    // evt.averageSpeed "m/s"
    // evt.averageSpeed "m/s"
    // evt.gustSpeed "m/s"
    // evt.chillfactor "°C"
    // evt.humidity "%"
    // evt.rainfall "mm"
    // evt.rainfallRate "mm/hr"
    // evt.rainfallIncrement "mm"
    // evt.uv "UVIndex"
    // evt.forecast

    adapter.log.debug('[' + event + ']: ' + JSON.stringify(data));
}

function processEnergy(event, data) {
    // rssi
    // batteryLevel
    // voltage "V"
    // current "A"
    // power "W"
    // energy "Wh"
    // powerFactor
    // frequency "Hz"
}

function processBlinds(event, data) {
    // rssi

}

function syncObjects(objs, callback) {
    if (!objs || !objs.length) {
        return callback && callback();
    }
    var task = objs.shift();
    adapter.getForeignObject(task._id, function (err, obj) {
        if (!obj) {
            adapter.setForeignObject(task._id, task, function () {
                setTimeout(syncObjects, 0, objs, callback);
            });
        } else {
            obj.native = task.native;
            obj.common.name = task.common.name;
            adapter.setForeignObject(obj._id, obj, function () {
                setTimeout(syncObjects, 0, objs, callback);
            });
        }
    });
}

function start() {
    comm = new rfxcom.RfxCom(adapter.config.comName, {debug: true});

    comm.on('ready', function () {
        setConnState(true);
    });

    comm.on('disconnect', function (msg) {
        adapter.log.debug('Disconnected: ' + msg);
        setConnState(false);
    });

    comm.on('connectfailed', function () {
        setConnState(false);
        adapter.log.error('unable to open the serial port: "' + adapter.config.comName + '"');
    });

    comm.on('response', function (desc, sequenceNum, responseCode) {
        adapter.log.debug('Response: ' + desc + ', ' + sequenceNum + ', ' + responseCode);
    });

    comm.on('receive', function (data) {
        adapter.log.debug('Raw data: ' + data.toString());
    });

    comm.on('status', function (status) {
        adapter.log.debug('JSON Status: ' + JSON.stringify(status));
    });

    for (var event in supportedEvents) {
        (function (evt) {
            comm.on(evt, function (e) {
                adapter.log.debug('Event "' + evt + '": ' + JSON.stringify(e));
                supportedEvents[evt](evt, e);
            });
        })(event);
    }

    comm.initialise(function () {
        adapter.log.info('RfxCom initialised on ' + comm.device);
    });

    var objs = [];

    // create rty devices
    for (var d = 0; d < adapter.config.devices; d++) {
        rtyDevices[adapter.namespace + '.rty.' + adapter.config.devices[d].deviceId + '_' + adapter.config.devices[d].unitCode] = new RTY(comm, {
            deviceId: adapter.config.devices[d].deviceId + '/' + adapter.config.devices[d].unitCode,
            subtype:  adapter.config.devices[d].subtype
        }, adapter.log);

        objs = objs.concat(objs, device.getObjects(adapter.namespace + '.rty.', adapter.config.devices[d].name));
    }

    syncObjects(objs);
}

function main() {
    adapter.config.inclusionTimeout = parseInt(adapter.config.inclusionTimeout, 10) || 0;

    adapter.getState('inclusionOn', function (err, state) {
        setInclusionState(state ? state.val : false);
    });

    adapter.setState('info.connection', false, true);

    // there are two types of devices: rty (only write) and all others

    // read current existing objects
    adapter.getForeignObjects(adapter.namespace + '.*', 'state', function (err, _states) {
        states = _states;
        adapter.getForeignObjects(adapter.namespace + '.*', 'channel', function (err, _channels) {
            channels = _channels;

            // subscribe on changes
            adapter.subscribeStates('*');
            adapter.subscribeObjects('*');

            /*for (var id in channels) {
                if (!channels.hasOwnProperty(id)) continue;

                if (channels[id].native.autoRepair) lastReceived[id] = new Date().getTime();
            }*/

            if (adapter.config.comName) {
                start();
            } else {
                adapter.log.warn('No COM port defined');
            }
        });
    });
}