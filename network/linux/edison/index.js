var log = require('../../../log').logger('network');
var os = require('os');
var config = require('../../../config')
var async = require('async');
var fs = require('fs');
var doshell = require('../../../util').doshell;
var util = require('util');
var NetworkManager = require('../../manager').NetworkManager;

var ifconfig = require('wireless-tools/ifconfig');
var iwconfig = require('wireless-tools/iwconfig');
var iwlist = require('wireless-tools/iwlist');
var wpa_cli = require('wireless-tools/wpa_cli');
var udhcpc = require('wireless-tools/udhcpc');
var udhcpd = require('wireless-tools/udhcpd');

var events = require('events');

var wifi;
var WIFI_SCAN_INTERVAL = 5000;
var WIFI_SCAN_RETRIES = 3;

var wifiInterface = 'wlan0';
var ethernetInterface = "enp0s17u1u1";
var apModeGateway= '192.168.42.1';
var tmpPath = os.tmpdir() + '/';

var DEFAULT_NETMASK = "255.255.255.0";
var DEFAULT_BROADCAST = "192.168.1.255"
var DHCP_MAGIC_TTL = 5000;
var ETHERNET_SCAN_INTERVAL = 2000;
var NETWORK_HEALTH_RETRIES = 8;
var NETWORK_HEALTH_RETRY_INTERVAL = 1500;

function jedison(cmdline, callback) {
    var callback = callback || function() {}
    doshell('./scripts/jedison ' + cmdline, function(s) {
        try {
            j = JSON.parse(s)
            if(j.status == 'success') {
                callback(null, j.data || {})
            } else {
                callback(j.message)
            }
        } catch(e) {
            log.error(e)
            log.error('jedison ' + cmdline);
            callback(e);
        }
    });
}

var EdisonNetworkManager = function() {
  this.mode = 'unknown';
  this.wifiState = 'idle';
  this.ethernetState = 'idle';
  this.networks = [];
  this.command = null;
  this.network_health_retries = NETWORK_HEALTH_RETRIES;
  this.network_history = {};
  this.networkInfo = {
  	wireless: null,
	  wired : null
  };
}
util.inherits(EdisonNetworkManager, NetworkManager);

// return an object containing {ipaddress:'',mode:''}
EdisonNetworkManager.prototype.getInfo = function(interface,callback) {
  //jedison('get wifi-info', callback);
  ifconfig.status(interface,function(err,ifstatus){
      if(err)return callback(err);
      iwconfig.status(interface,function(err,iwstatus){
        if(err)return callback(err);
        callback(null,{ssid : (iwstatus.ssid || '<Unknown>'), ipaddress:ifstatus.ipv4_address,mode:iwstatus.mode})
      })
  })
}

EdisonNetworkManager.prototype.getLocalAddresses = function() {
	var retval = [];
	try {
		if(this.networkInfo.wireless) {
			retval.push(this.networkInfo.wireless);
		}
		if(this.networkInfo.wired) {
			retval.push(this.networkInfo.wired);
		}
		log.debug('Returning a list of local addresses: ' + retval);
		return retval;
	} catch(e) {
		return retval;
	}
}

// return an object formatted like this :
EdisonNetworkManager.prototype.getNetworks = function(callback) {
  //jedison('get networks', callback);
  wpa_cli.scan_results(wifiInterface, callback);
}

EdisonNetworkManager.prototype.scan = function(callback) {
  wpa_cli.scan(wifiInterface, callback);
}

EdisonNetworkManager.prototype.runWifi = function() {
    if(this.command) {
  switch(this.command.cmd) {
    case 'join':
      var ssid = this.command.ssid;
      var pw = this.command.password;
      this.command = null;
      this.wifiState = 'idle';
      this.mode = 'unknown';
      this._joinWifi(ssid,pw,function(err, data) {
        this.runWifi();
      }.bind(this));
      break;

    case 'ap':
      this.command=null;
      this.wifiState = 'idle'
      this.mode = 'unknown'
      this._joinAP(function(err, data) {
        this.runWifi();
      }.bind(this));
      break;
    case 'noap':
      this.command = null;
      this.wifiState = 'idle'
      this.mode = 'unknown'
      this._unjoinAP(function(err, data) {
        this.runWifi();
      }.bind(this));
      break;
    case 'off':
      this.command = null;
      this.wifiState = 'off'
      this.mode = 'off'
      if(this.wifiStatus != 'disabled') {
        this._disableWifi(function(err, data) {
            if(err) { log.error(err); }
            this.wifiStatus = 'disabled';
            this.runWifi();
        }.bind(this));
      } else {
        setTimeout(this.runWifi.bind(this), 1000);
      }
      break;
   case 'on':
      this.command = null;
      this.wifiState = 'idle'
      this.mode = 'idle'
      this.turnWifiOn(function() {
         this.runWifi();
      }.bind(this));
      break;

  }
  return;
}
  switch(this.mode) {
    case 'ap':
      this.runWifiAP();
      break;

    case 'station':
      this.runWifiStation();
      break;

    case 'off':
      setTimeout(this.runWifi.bind(this), 2000);
      break;

    default:
      this.wifiState = 'idle';
      this.getInfo(wifiInterface,function(err, data) {
        if(!err) {
         var old_mode = this.mode;
         log.info("Wireless mode is '" + data.mode + "'");
         if(data.mode == 'managed') {this.mode = 'station';}
         else if(data.mode == 'master') { this.mode = 'ap';}
         else { log.warn('Unknown network mode: ' + data.mode)}
         if(this.mode != old_mode) {
		setImmediate(this.runWifi.bind(this));
         }else{
           setTimeout(this.runWifi.bind(this), 5000);
    }
  } else {
        setTimeout(this.runWifi.bind(this), 5000);
}

      }.bind(this));
      break;
  }
}

EdisonNetworkManager.prototype.runWifiStation = function() {
  switch(this.wifiState) {
    case 'idle':
      this.scan_retries = WIFI_SCAN_RETRIES;
      // Fall through
    case 'scan':
      this.scan(function(err, data) {
        this.wifiState = 'done_scanning';
        setTimeout(this.runWifi.bind(this), WIFI_SCAN_INTERVAL);
      }.bind(this));
      break;

    case 'done_scanning':
      this.getNetworks(function(err, data) {
        if(!err) {
          var new_networks = 0;
          var new_network_names = [];
          for(var i in data) {
            var ssid = data[i].ssid;
            var found = false;
            for(var j in this.networks) {
                if(this.networks[j].ssid === ssid) {
                    found = true;
                    break;
                }
            }
            if(!found) {
              new_networks += 1;
              new_network_names.push(ssid);
              this.networks.push(data[i]);
             }
          }
          if(new_networks > 0) {
              log.info('Found ' + new_networks + ' new networks. (' + new_network_names.join(',') + ')')
          }
        }
        if((err || data.length === 0) && (this.scan_retries > 0)) {
          log.warn("No networks?!  Retrying...");
          this.wifiState = 'scan'
          this.scan_retries--;
        } else {
          this.wifiState = 'check_network';
          this.network_health_retries = NETWORK_HEALTH_RETRIES;
        }
        setImmediate(this.runWifi.bind(this));
      }.bind(this));
      break;

    case 'check_network':
      this.getInfo(wifiInterface,function(err, data) {
        var networkOK = true;
        if(!err) {
          if(data.ipaddress === '?' || data.ipaddress === undefined) {
            networkOK = false;
          }
          if(data.mode === 'master') {
            log.info("In master mode...");
            this.mode = 'ap';
            this.wifiState = 'idle';
            this.emit('network', {'mode' : 'ap'})
            setImmediate(this.runWifi.bind(this));
          }
        } else {
          networkOK = false;
        }
        if(networkOK) {
          this.wifiState = 'idle';
          this.wifiStatus = 'enabled';
          this.networkInfo.wireless = data.ipaddress;
	  this.network_history[data.ssid] = {
            ssid : data.ssid,
            ipaddress : data.ipaddress,
            last_seen : Date.now()
          }
          setImmediate(this.runWifi.bind(this));
        } else {
          log.warn("Network health in question...");
	  log.warn(JSON.stringify(data));
          if(this.network_health_retries == 0) {
              log.error("Network is down.  Going to AP mode.");
              this.network_health_retries = NETWORK_HEALTH_RETRIES;
              this.joinAP();
              setImmediate(this.runWifi.bind(this));
    } else {
             this.network_health_retries--;
             setTimeout(this.runWifi.bind(this),NETWORK_HEALTH_RETRY_INTERVAL);
    }
  }
      }.bind(this));
      break;
  }
}

EdisonNetworkManager.prototype.runWifiAP = function() {
  switch(this.wifiState) {
    default:
      this.getInfo(wifiInterface,function(err, data) {
        if(!err) {
          if(data.mode === 'managed') { this.mode = 'station'; }
          else if(data.mode === 'master') { this.mode = 'ap'; }
          else { log.warn('Unknown network mode: ' + data.mode)}
        }
        setTimeout(this.runWifi.bind(this), 5000);
      }.bind(this));
      break;
  }
}


EdisonNetworkManager.prototype.joinAP = function() {
  this.command = {
    'cmd' : 'ap',
  }
}

EdisonNetworkManager.prototype._joinAP = function(callback) {
  log.info("Entering AP mode...");
  var network_config = config.updater.get('network');
  network_config.wifi.mode = 'ap';
  config.updater.set('network', network_config);
  jedison('join ap', function(err, result) {
    if(!err) {
      log.info("Entered AP mode.");
    }
    callback(err, result);
  });
}

EdisonNetworkManager.prototype.enableWifi = function(){
  this.command = {
    'cmd' : 'on'
  }
}

EdisonNetworkManager.prototype.disableWifi = function(){
  this.command = {
    'cmd' : 'off'
  }
}

EdisonNetworkManager.prototype._disableWifi = function(callback){
  log.info("Disabling wifi...");
  //var network_config = config.updater.get('network');
  //network_config.mode = 'off';
  //config.updater.set('network', network_config);
  doshell("systemctl stop hostapd wpa_supplicant",function(err,result){
    if(err)log.warn(err);
    ifconfig.down(wifiInterface,function(err, result){
      if(!err) {
    log.info("Wifi disabled.");
      }
      callback(err, result);
    });
});
}

EdisonNetworkManager.prototype.joinWifi = function(ssid, password) {
  this.command = {
    'cmd' : 'join',
    'ssid' : ssid,
    'password' : password
  }
}

EdisonNetworkManager.prototype._joinWifi = function(ssid, password, callback) {
  var self = this;
  log.info("Attempting to join wifi network: " + ssid + " with password: " + password);
  var network_config = config.updater.get('network');
  network_config.wifi.mode = 'station';
  network_config.wifi.wifi_networks = [{'ssid' : ssid, 'password' : password}];
  config.updater.set('network', network_config);
  jedison('join wifi --ssid="' + ssid + '" --password="' + password + '"', function(err, result) {
    if(err) {
        log.error(err);
    }
    self.setGateway(apModeGateway,function(err,result) {
        this.emit('network', {'mode' : 'station'});
        callback(err, result);
    }.bind(this));
  }.bind(this));
}

EdisonNetworkManager.prototype.unjoinAP = function() {
  this.command = {
    'cmd' : 'noap'
  }
}

EdisonNetworkManager.prototype._unjoinAP = function(callback) {
  jedison('unjoin', function(err, result) {
    if(err) {
      log.error(err);
    }
    callback(err, result);
  });
}

EdisonNetworkManager.prototype.applyWifiConfig = function() {
  var network_config = config.updater.get('network');
  switch(network_config.wifi.mode) {
    case 'ap':
      this.unjoinAP();
      break;
    case 'station':
      if(network_config.wifi.wifi_networks.length > 0) {
        var network = network_config.wifi.wifi_networks[0];
        this.joinWifi(network.ssid, network.password);
      } else {
        log.warn("No wifi networks defined.");
      }
      break;
    case 'off':
      //this.disableWifi(); //TODO : discuss about this issue. it may be not recommended to do this as a reboot would remove wifi and the tool would be lost if you don't have a ethernet access.
      break;
  }
}

/*
 * PUBLIC API BELOW HERE
 */

EdisonNetworkManager.prototype.init = function() {
  log.info('Initializing network manager...');
  jedison("init --name='" + config.updater.get('name') + "' --password='" + config.updater.get('password') + "'", function(err, data) {
    log.info('Applying network configuration...');
      this.applyNetworkConfig();
    log.info('Running wifi...');
    this.runWifi();
    this.runEthernet();
  }.bind(this));
}

EdisonNetworkManager.prototype.getAvailableWifiNetworks = function(callback) {
  callback(null, this.networks);
}

EdisonNetworkManager.prototype.connectToAWifiNetwork= function(ssid,key,callback) {
  this.joinWifi(ssid, key, callback);
}

EdisonNetworkManager.prototype.turnWifiOn=function(callback){
  //callback(new Error('Not available on the edison wifi manager.'));
    ifconfig.status(wifiInterface,function(err,status){
        if(!status.up){
            ifconfig.up(wifiInterface,function(err, data) {
                this.mode=undefined;
                this.wifiStatus = 'enabled';
                callback(err);
            }.bind(this));
        } else {
            callback();
        }
  }.bind(this));
}

EdisonNetworkManager.prototype.turnWifiOff=function(callback){
  //callback(new Error('Not available on the edison wifi manager.'));
  this.disableWifi();
}

EdisonNetworkManager.prototype.getWifiHistory=function(callback){
  callback(null, this.network_history);
}

EdisonNetworkManager.prototype.turnWifiHotspotOn=function(callback){
  log.info("Entering AP mode...")
  this.joinAP();
  callback(null);
}

EdisonNetworkManager.prototype.getStatus = function(callback) {
  ifconfig.status(callback);
  //var status = {'wifi' : {}}
}

EdisonNetworkManager.prototype.setIdentity = function(identity, callback) {
  async.series([
    function set_name(callback) {
      if(identity.name) {
        log.info("Setting network name to " + identity.name);
        jedison("set name '" + identity.name + "'", callback);
      } else {
        callback(null);
      }
    }.bind(this),

    function set_name_config(callback) {
      if(identity.name) {
        config.updater.set('name', identity.name, callback);
      } else {
        callback(null);
      }
    }.bind(this),

    function set_password(callback) {
      if(identity.password) {
        log.info("Setting network password to " + identity.password);
        jedison("set password '" + identity.password + "'", callback);
      } else {
        callback(null);
      }
    }.bind(this),

    function set_password_config(callback) {
      if(identity.password) {
        config.updater.set('password', identity.password, callback);
      } else {
        callback(null);
      }
    }.bind(this)

    ],

    function(err, results) {
        if(err) {
            log.error(err);
            typeof callback === 'function' && callback(err);
        } else {
            typeof callback === 'function' && callback(null, this);
        }
    }.bind(this)
  );
}

EdisonNetworkManager.prototype.isOnline = function(callback) {
  setImmediate(callback, null, this.mode === 'station');
}


//Ethernet section
EdisonNetworkManager.prototype.turnEthernetOn=function(callback) {
  ifconfig.up(ethernetInterface,callback);
}

EdisonNetworkManager.prototype.turnEthernetOff=function(callback) {
  ifconfig.down(ethernetInterface,callback);
}

// interface specific - static addressing
EdisonNetworkManager.prototype.enableDHCP=function(interface, callback) {
log.debug('Enabling DHCP on ' + interface);
udhcpc.enable({interface: interface},callback)
}

EdisonNetworkManager.prototype.disableDHCP=function(interface, callback) {
log.debug('Disabling DHCP on ' + interface);
  udhcpc.disable(interface,callback);
}

EdisonNetworkManager.prototype.startDHCPServer=function(interface, callback) {
  var ethernet_config = config.updater.get('network').ethernet;
  var options = {
    interface: interface,
    tmpPath: tmpPath,
    start: ethernet_config.default_config.dhcp_range.start || '192.168.44.20',
    end: ethernet_config.default_config.dhcp_range.end || '192.168.44.254',
    option: {
      router: ethernet_config.default_config.ip_address || '192.168.44.1',
      subnet: ethernet_config.default_config.netmask || '255.255.255.0',
      dns: ethernet_config.default_config.dns || ["8.8.8.8"]
    }
  };
  udhcpd.enable(options,callback);
}

EdisonNetworkManager.prototype.stopDHCPServer=function(interface, callback) {
  udhcpd.disable({interface:interface,tmpPath:tmpPath},callback);
}

EdisonNetworkManager.prototype.setIpAddress=function(interface, ip, callback) {
  if(!ip)return callback("no ip specified !");
  ifconfig.status(interface, function(err, status) {
    if(err)return callback(err,status);
    var options = {
      interface: interface,
      ipv4_address: ip,
      ipv4_broadcast: status.ipv4_broadcast || DEFAULT_BROADCAST,
      ipv4_subnet_mask: status.ipv4_subnet_mask || DEFAULT_NETMASK
    };
    ifconfig.up(options, callback);
  });
}

EdisonNetworkManager.prototype.setNetmask=function(interface, netmask, callback) {
  if(!netmask)return callback("no netmask specified !");
  ifconfig.status(interface, function(err, status) {
    if(err)return callback(err,status);
    if(!status.ipv4_address)return callback('interface ip address not configured !');
    var options = {
      interface: interface,
      ipv4_address: status.ipv4_address,
      ipv4_broadcast: netmask,
      ipv4_subnet_mask: status.ipv4_subnet_mask || DEFAULT_NETMASK
    };
    ifconfig.up(options, callback);
  });
}

EdisonNetworkManager.prototype.setGateway=function(gateway, callback) {
  doshell('route add default gw '+ gateway, function(s) {
    callback(null);
  });
}

EdisonNetworkManager.prototype.applyNetworkConfig=function(){
  this.applyWifiConfig();
//  this.applyEthernetConfig();
}

EdisonNetworkManager.prototype.applyEthernetConfig=function(){
  var self = this;
  var ethernet_config = config.updater.get('network').ethernet;
  ifconfig.status(ethernetInterface,function(err,status){
    if(status.up && status.running){
      async.series([
        self.disableDHCP.bind(this,ethernetInterface),
        self.stopDHCPServer.bind(this,ethernetInterface)
      ],function(err,results){
        if(err)log.warn(err);
	this.emit('network', {'mode':'ethernet'});
        log.info("ethernet is in "+ethernet_config.mode+" mode");
        switch(ethernet_config.mode) {
          case 'static':
            async.series([
              self.setIpAddress.bind(this,ethernetInterface,ethernet_config.default_config.ip_address),
              self.setNetmask.bind(this,ethernetInterface,ethernet_config.default_config.netmask),
              self.setGateway.bind(this,ethernet_config.default_config.gateway)
            ],function(err,results){
              if(err) log.warn(err);
              else log.info("Ethernet static configuration is set");
            });
            break;

          case 'dhcp':
            self.enableDHCP(ethernetInterface,function(err){
              if(err)return log.warn(err);
              log.info("Ethernet dynamic configuration is set");
            });
            break;

          case 'magic':
            self.enableDHCP(ethernetInterface,function(err){
              setTimeout(function(){
                ifconfig.status(ethernetInterface,function(err,status){
                  if(err)log.warn(err);
                  if(status.ipv4_address!==undefined) {// we got a lease !
                    	this.networkInfo.wired = status.ipv4_address;
		  	log.info("[magic mode] An ip address was assigned to the ethernet interface : "+status.ipv4_address);
                    	return;
		  }
		  else{ // no lease, stop the dhcp client, set a static config and launch a dhcp server.
                    async.series([
                      self.disableDHCP.bind(this,ethernetInterface),
                      self.setIpAddress.bind(this,ethernetInterface,ethernet_config.default_config.ip_address),
                      self.setNetmask.bind(this,ethernetInterface,ethernet_config.default_config.netmask),
                      self.setGateway.bind(this,ethernet_config.default_config.gateway),
                      self.startDHCPServer.bind(this,ethernetInterface)
                  ],function(err,results){
                      if(err) log.warn(err);
                      else log.info("[magic mode] No dhcp server found, switched to static configuration and launched a dhcp server...");
                  });
                  }
                }.bind(this));
              }.bind(this),DHCP_MAGIC_TTL);
            }.bind(this));
            break;

          case 'off':
          default:
            break;
        }
      }.bind(this));
    }
  }.bind(this));
}

EdisonNetworkManager.prototype.runEthernet = function(){
  var self = this;
  function checkEthernetState(){
    var oldState = this.ethernetState;
    ifconfig.status(ethernetInterface,function(err,status){
        if(!err && status.up && status.running){
            try {

            this.network_history[null] = {
                ssid : null,
                ipaddress : status.ipv4_address,
                last_seen : Date.now()
            }
	    this.networkInfo.wired = status.ipv4_address;
            } catch(e) {
                log.warn('Could not save ethernet address in network history.')
            }
            this.ethernetState = "plugged";
            var network_config = config.updater.get('network')
            try {
                if(!network_config.wifi.enabled) {
                    if(this.wifiStatus != 'disabled') {
                        this.turnWifiOff()
                    }
                }
            } catch(e) {
                log.error(e);
            }
        }else{
            this.ethernetState = "unplugged";
        }
        if(this.ethernetState!==oldState){
            switch(this.ethernetState) {
                case "plugged":
                    log.info("ethernet cable was plugged");
                    this.applyEthernetConfig();
                    break;
                case "unplugged":
                    log.info("Ethernet cable was unplugged.");
                    this.enableWifi();
                    break;
                default:
                    log.error("Unknown ethernet state. (Bad error)");
                    break;
            }
        }
    }.bind(this));
  }
    checkEthernetState.bind(this)();
  setInterval(checkEthernetState.bind(this),ETHERNET_SCAN_INTERVAL);

}

exports.NetworkManager = EdisonNetworkManager;
