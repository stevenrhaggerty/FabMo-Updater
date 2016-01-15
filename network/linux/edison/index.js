var log = require('../../../log').logger('network');
var config = require('../../../config').Update
var async = require('async');
var fs = require('fs');
var doshell = require('../../../util').doshell;
var util = require('util');
var NetworkManager = require('../../manager').NetworkManager;

var wifi;
var WIFI_SCAN_INTERVAL = 5000;
var WIFI_SCAN_RETRIES = 3;

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
            callback(e);
        }
    });
}

var EdisonNetworkManager = function() {
  this.mode = 'unknown';
  this.state = 'idle';
  this.networks = [];
  this.command = null;
  this.network_health_retries = 5;
}
util.inherits(EdisonNetworkManager, NetworkManager);

EdisonNetworkManager.prototype.getInfo = function(callback) {
  jedison('get wifi-info', callback);
}

EdisonNetworkManager.prototype.getNetworks = function(callback) {
  jedison('get networks', callback);
}

EdisonNetworkManager.prototype.scan = function(callback) {
  jedison('scan', callback);
}

EdisonNetworkManager.prototype.run = function() {
  if(this.command) {
	switch(this.command.cmd) {
		case 'join':
			var ssid = this.command.ssid;
			var pw = this.command.password;
			this.command = null;
			this.state = 'idle';
			this.mode = 'unknown';
			this._joinWifi(ssid,pw,function(err, data) {
				this.run();
			}.bind(this));
			break;

		case 'ap':
			this.command=null;
			this.state = 'idle'
			this.mode = 'unknown'
			this._joinAP(function(err, data) {
				this.run();
			}.bind(this));
			break;
	}
	return;
} 
  switch(this.mode) {
    case 'ap':
      this.runAP();
      break;

    case 'station':
      this.runStation();
      break;

    default:
      this.state = 'idle';
      this.getInfo(function(err, data) {
        if(!err) {
          var old_mode = this.mode;
		if(data.mode == 'managed') { this.mode = 'station'; log.debug("Going into station mode");}
          else if(data.mode == 'master') { this.mode = 'ap'; log.debug("Going into AP mode."); }
          else { log.warn('Unknown network mode: ' + data.mode)}
        	if(this.mode != old_mode) {

        setImmediate(this.run.bind(this));
		} else {

        setTimeout(this.run.bind(this), 5000);

}
	} else {

        setTimeout(this.run.bind(this), 5000);
}

      }.bind(this));
      break;
  }
}

EdisonNetworkManager.prototype.runStation = function() {
  switch(this.state) {
    case 'idle':
      this.scan_retries = WIFI_SCAN_RETRIES;
      // Fall through
    case 'scan':  
      this.scan(function(err, data) {
        this.state = 'done_scanning';
        setTimeout(this.run.bind(this), WIFI_SCAN_INTERVAL);        
      }.bind(this));
      break;

    case 'done_scanning':
      this.getNetworks(function(err, data) {
        if(!err) {
	        //log.debug('Scanned and found ' + data.length + ' networks.')
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
                 this.networks.push(data[i]);
             }
          }
        } else {
          console.warn(err);
        }
        if(data.length === 0 && this.scan_retries > 0) {
        log.warn("No networks?!  Retrying...");
	this.state = 'scan'
        this.scan_retries--;
} else {
        this.state = 'check_network';
        this.network_health_retries = 5;
}
        setImmediate(this.run.bind(this));
      }.bind(this));
      break;

    case 'check_network':
      //log.debug('Checking network health...');
      this.getInfo(function(err, data) {
        var networkOK = true;
        if(!err) {
          if(data.ipaddress === '?') {
           	log.warn("Ip address == ?"); 
		networkOK = false;
          }
          if(data.mode === 'master') {
             log.info("In master mode..."); 
	     this.mode = 'ap';
             this.state = 'idle';
             setImmediate(this.run.bind(this));
          }
        } else {
          networkOK = false;
        }
        if(networkOK) {
          //log.debug("Network health OK");
          this.state = 'idle';          
          setImmediate(this.run.bind(this));
        } else {
          log.warn("Network health in question...");
          if(this.network_health_retries == 0) {
              log.error("Network is down.  Going to AP mode.");
              this.network_health_retries = 5;
       	      this.joinAP();
              setImmediate(this.run.bind(this)); 
	  } else {
             this.network_health_retries--;
             setTimeout(this.run.bind(this),1000);
	  }
	}
      }.bind(this));
      break;
  }
}

EdisonNetworkManager.prototype.runAP = function() {
  switch(this.state) {
    default:
      this.getInfo(function(err, data) {
        if(!err) {
          if(data.mode === 'managed') { this.mode = 'station'; }
          else if(data.mode === 'master') { this.mode = 'ap'; }
          else { log.warn('Unknown network mode: ' + data.mode)}
        }
        setTimeout(this.run.bind(this), 5000);
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
  log.info("Attempting to enter AP mode"); 
  jedison('join ap', function(err, result) {
    if(!err) {
      log.info("Entered AP mode.");
    }
    callback(err, result);
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
  log.info("Attempting to join wifi network: " + ssid + " with password: " + password); 
  jedison('join wifi --ssid=' + ssid + ' --password=' + password , function(err, result) {
    if(err) {
        log.error(err);
    }
    log.debug(result);
    callback(err, result);
  });
}

/*
 * PUBLIC API BELOW HERE
 */

EdisonNetworkManager.prototype.init = function() {
  jedison('init', function(err, data) {
    this.run();
  }.bind(this));
}

EdisonNetworkManager.prototype.getAvailableWifiNetworks = function(callback) {
  callback(null, this.networks);
}

EdisonNetworkManager.prototype.connectToAWifiNetwork= function(ssid,key,callback) {
  this.joinWifi(ssid, key, callback);
}

EdisonNetworkManager.prototype.turnWifiOn=function(callback){
  callback(new Error('Not available on the edison wifi manager.'));
}

EdisonNetworkManager.prototype.turnWifiOff=function(callback){
  callback(new Error('Not available on the edison wifi manager.'));
}

EdisonNetworkManager.prototype.turnWifiHotspotOn=function(callback){
  log.info("Entering AP mode...")
  this.joinAP();
  callback(null);
}

EdisonNetworkManager.prototype.setName=function(name, callback){
  jedison("set name '" + config.updater.get('name') + "'", function(err, data) {
    if(this.mode === 'ap') {
      this.joinAP(callback)
    }
  }.bind(this));
}

EdisonNetworkManager.prototype.setPassword=function(name, callback){
  jedison("set password '" + config.updater.get('password') + "'", callback);
}

exports.NetworkManager = EdisonNetworkManager;
