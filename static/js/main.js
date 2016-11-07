// Create instance for communicating with the update service
var updater = new UpdaterAPI();
var modalShown = false;

// Deal with switching tasks using the left menu
$('.menu-item').click(function() {
    if(!this.dataset.id) {return;}
    switch(this.dataset.id) {
      case undefined:
      return;

      case 'simple-updater':
        launchSimpleUpdater();
        break;

      case 'goto-dashboard':
        launchDashboard();
        break;

      default:
        $('.content-pane').removeClass('active');
        $('#' + this.dataset.id).addClass('active');
        $('.menu-item').removeClass('active');
        $(this).addClass('active');
        break;
    }
});

function setOS(os) {
  var icons = {
    linux : 'fa fa-linux',
    darwin : 'fa fa-apple',
    win32 : 'fa fa-windows',
    win64 : 'fa fa-windows'
  }
  try {
    var iconClass = icons[os] || 'fa fa-question';
  } catch(e) {
    iconClass = 'fa fa-question';
  }
  $("#network-id-icon").attr('class', iconClass)
}

function setOnline(online) {
  if(online) {
    $('#update-controls').show();
    $('#message-noupdate-ap').hide();
  } else {
    $('#update-controls').hide();
    $('#message-noupdate-ap').show();
  }
}

var lastLevel = ''
// Prettify lines for "console" output
function prettify(line) {
  var line_re = /^(\w*)\:(.*)/i;
  var match = line_re.exec(line);
  if(match) {
    var level = match[1];
    var msg = match[2];
    lastLevel = level;
    return '<span class="loglevel-' + level + '">' + level + ':</span>' + msg + '\n'
  } else {
    blank = [];
    for(var i=0; i<lastLevel.length; i++) {
      blank = blank + ' ';
    }
    return blank + '  ' + line + '\n'
  }
}

// Print a line to the "console"
function printf(s) {
    var log = $('#console .content');
    lines = s.split('\n');
    lines.forEach(function(line) {
      log.append(prettify(line));
    });
    var scrollpane = $('#console');
    scrollpane[0].scrollTop = scrollpane[0].scrollHeight;
}

function clearConsole() {
    var log = $('#console .content');
    log.text('');
}

function updateNetworks(callback) {
    updater.getWifiNetworks(function(err, networks) {
        if(err) {
            $('#network-table').hide();
            $('#message-no-networks').show();
            return callback(err);
        }

        // Clear the existing networks
        var table = document.getElementById('network-table');
        var rows = table.rows.length;
        for(var i=1; i<rows; i++) {
            table.deleteRow(1);
        }

        if(!networks || networks.length === 0) {
            $('#network-table').hide();
            $('#message-no-networks').show();
        } else {
            $('#network-table').show();
            $('#message-no-networks').hide();
        }
        // Add the newly defined ones
        networks.forEach(function(network) {
            var row = table.insertRow(table.rows.length);
      row.onclick = function(evt) {
    $('#network-ssid').val(network.ssid);
    $('#network-key').focus();
      }
     var ssid = row.insertCell(0);
            var security = row.insertCell(1);
            var strength = row.insertCell(2);
            ssid.innerHTML = network.ssid || '<No SSID>';
            security.innerHTML = (network.security || []).join('/');
        });
        callback();
    });
}

function updateVersions() {

  // The update version menu
  updater.getVersions(function(err, versions) {
    menu1 = $("#update-version");
    versions.forEach(function(entry) {
      menu1.append('<option value="' + entry.version + '">' + entry.version + '</option>');
      //menu2.append('<option value="' + entry.version + '">' + entry.version + '</option>');
    });
    menu1.append('<option value="rc">Release Candidate</option>');

    $('#btn-update-stable').removeClass('disabled');
    $('#update-version').removeClass('disabled');
    $('#icon-update-version-spinner').hide();
  });

}

function launchSimpleUpdater() {
  showModal({
    title : 'Launch Simple Updater',
    message : 'This will launch the simple update service and <em>update your engine to the latest stable release... Are you sure you wish to do this?</em>',
    icon : 'fa-question-circle',
    okText : 'Yes',
    cancelText : 'No',
    ok : function() {
      window.open('/do_update');
    },
    cancel : function() {
      dismissModal();
    }
  })
}

function launchDashboard() {
  showModal({
    title : 'Go to Dashboard?',
    message : 'Do you want to leave the updater and go to the FabMo dashboard?',
    okText : 'Yes',
    cancelText : 'No',
    ok : function() {
      window.open(updater.getEngineURL(), "_self");
    },
    cancel : function() {
      dismissModal();
    }
  })
}

function setState(state) {
    var stateText = state.charAt(0).toUpperCase() + state.slice(1);
    $('#updater-status-text').text(' ' + stateText);
    $('#updater-status').removeClass('status-idle status-updating status-disconnected').addClass('status-' + state);
    var icon = $('#updater-status-icon');
    var classes = 'fa-circle-o fa-spin fa-spinner fa-chain-broken'
    switch(state) {
        case 'idle':
            icon.removeClass(classes).addClass('fa-circle-o');
            break;

        case 'disconnected':
            icon.removeClass(classes).addClass('fa-chain-broken');
            break;

        case 'updating':
            icon.removeClass(classes).addClass('fa-spin fa-spinner');
            break;
    }
}

function showModal(options) {
  var options = options || {};

  if(modalShown) {
    return;
  }

  // Title
  if(options.title) {
    $('#modal-title').html(' ' + options.title).show();
  } else {
    $('#modal-title').hide();
  }

  // Message
  if(options.message) {
    $('#modal-text').html(options.message).show();
  } else {
    $('#modal-text').hide();
  }

  // Buttons
  if(options.ok || options.cancel) {
    $('#modal-buttons').show();
  } else {
    $('#modal-buttons').hide();
  }

  if(options.ok) {
    $('#btn-modal-ok').html(options.okText || 'Ok').show();
    $('#btn-modal-ok').click(function(evt) {
      options.ok()
    });
  } else {
    $('#btn-modal-ok').hide();
  }
  if(options.cancel) {
    $('#btn-modal-cancel').html(options.cancelText || 'Cancel').show();
    $('#btn-modal-cancel').click(function(evt) {
      options.cancel()
    });

  } else {
    $('#btn-modal-cancel').hide();
  }

  if(options.icon) {
    $('#modal-icon').removeClass().addClass('fa fa-lg ' + options.icon).show();
  } else {
    $('#modal-icon').hide();
  }
  modalShown = true;
  $('#modal').show();
}

function dismissModal() {
  if(!modalShown) { return; }
  $('#btn-modal-ok').off('click');
  $('#btn-modal-cancel').off('click');
  modalShown = false;
  $('#modal').hide();
}

$(document).ready(function() {

  // Updater Events
  updater.on('log', function(msg) {
    printf(msg);
  });

  updater.on('status', function(status) {
    setState(status.state);
    setOnline(status.online);
    dismissModal();
  });

  updater.on('disconnect', function(state) {
    setState('disconnected');
    showModal({
      title : 'Updater Disconnected',
      message : 'This session is no longer connected to the updater.  This may be because the updater has changed networks.  This message will dismiss if connection is reestablished.',
      icon : 'fa-chain-broken'
    });
  });

  //
  // Updates
  //
  $("#btn-update-latest").click( function(evt) {
    evt.preventDefault();
    updater.updateEngine('master');
  });

  $("#btn-update-updater-latest").click( function(evt) {
    evt.preventDefault();
    updater.updateUpdater('master');
  });

  $("#form-update-stable").submit(function(evt) {
    evt.preventDefault();
    updater.updateEngine($("#update-version").val());
  });

  $("#btn-update-firmware").click( function(evt) {
    evt.preventDefault();
    updater.updateFirmware();
  });


$("#btn-reinstall").click( function(evt) {
    evt.preventDefault();
    showModal({
      title : 'Reinstall Engine?',
      message : 'This will reinstall the FabMo engine <em>from scratch</em> - You will lose all your settings and apps, and will take several minutes.  This is only to be done in circumstances in which <em>the engine is corrupted and unrecoverable by any other means</em> - Are you sure you wish to do this?  Are you absolutely sure?',
      icon : 'fa-exclamation-circle',
      okText : 'Yes!  I understand the risk!',
      cancelText : 'No!  Get me out of here!',
      ok : function() {
        updater.installEngine()
      },
      cancel : function() {
        dismissModal();
      }
    });
  });

$("#btn-factory-reset").click( function(evt) {
    evt.preventDefault();
    showModal({
      title : 'Factory Reset?',
      message : 'This will reset your software to its factory state.  This process is not reversible and you will lose all data.  Are you certain you want to do this?  <em>Are you really really sure? This is a destructive operation.  It will take some time, and you will lose contact with the updater temporarily.</em>',
      icon : 'fa-exclamation-circle',
      okText : 'Yes!  I understand the risk!',
      cancelText : 'No!  Get me out of here!',
      ok : function() {
        updater.factoryReset();
        dismissModal();
      },
      cancel : function() {
        dismissModal();
      }
    });
  });

  //
  // Network Management
  //
  $("#btn-network-ap-mode").click(function() {updater.enableHotspot()});

  $("#form-network-id").submit(function(evt) {
    evt.preventDefault();
    var name = $('#network-name').val();
    var password = $('#network-password').val();
    var options = {};
    if(name) {
        options['name'] = name;
    }
    if(password) {
        options['password'] = password;
    }

    updater.setNetworkIdentity(options, function(err, data) {
        if(err) {
          console.error(err);
        } else {
          updater.getNetworkIdentity(function(err, id) {
            $(".label-network-id").text(id.name);
          });
        }
      });
  });

  $("#form-join-network").submit(function(evt) {
    evt.preventDefault();
      var ssid = $('#network-ssid').val();
      var key = $('#network-key').val();
      showModal({
    title : 'Change Networks?',
    message : 'Do you wish to join the network "' + ssid + '"? You will be <em>disconnected from the updater</em> and will need to reconnect to the target wireless network.',
    icon : 'fa-question-circle',
    okText : 'Yes',
    cancelText : 'No',
    ok : function() {

      updater.connectToWifi(ssid, key);
      dismissModal();
    },
    cancel : function() {
      dismissModal();
    }
  });

  });

  //
  // System Functions
  //
  $("#btn-start-engine").click(function() {updater.startEngine()});
  $("#btn-stop-engine").click(function() {updater.stopEngine()});


  // Console clear
  $('#btn-console-clear').click(function() {clearConsole()});

  $('#btn-update-fmu').click(function() {
    jQuery('#file').trigger('click');
  });

 $('#file').change(function(evt) {
    $('.progressbar').removeClass('hide');
    var files = [];
    for(var i=0; i<evt.target.files.length; i++) {
      files.push({file:evt.target.files[i]});
    }
    updater.submitFMU(files, {}, function(err, data) {
      setTimeout(function() {
        $('.progressbar').addClass('hide');
        $('.progressbar .fill').width(0);
      }, 750);
      $('#file').val(null);

    }, function(progress) {
      var pg = (progress*100).toFixed(0) + '%';
      $('.progressbar .fill').width(pg);
    });
  });

  // Pull available update versions
  updateVersions();
  // Start a polling loop for networks...
  function updateService() {
    updateNetworks(function(err) {
        setTimeout(updateService,5000);
    });
  }
  updateService();

  updater.getNetworkIdentity(function(err, id) {
    $(".label-network-id").text(id.name);
  });

  updater.getConfig(function(err, config) {
    var updater_version_number = 'unavailable';
    try{
      updater_version_number = config.version.number || config.version.hash.substring(0,8) + '-' + config.version.type      
    } catch(e) {}
    
    $('.label-updater-version').text(updater_version_number)
    $('.label-network-mode').text(config.network.mode);
    $('.label-engine-git').text(config.engine_git_repos);
    $('.label-updater-git').text(config.updater_git_repos);
    $('.label-platform').text(config.os + '/' + config.platform);
    $('.label-os-version').text(config.os_version);
    $('.label-machine-id').text(config.id);
    setOS(config.os);
  });

  updater.getEngineInfo(function(err, info) {
    if(err) {
      $('.label-engine-version').text('unavailable');
      $('.label-fw-build').text('unavailable');
      $('.label-fw-config').text('unavailable');
      $('.label-fw-version').text('unavailable');

    } else {
      var engine_version_number = info.version.number || info.version.hash.substring(0,8) + '-' + info.version.type
      $('.label-fw-build').text(info.firmware.build || 'unavailable');
      $('.label-fw-config').text(info.firmware.config || 'unavailable');
      $('.label-fw-version').text(info.firmware.version || 'unavailable');
      $('.label-engine-version').text(engine_version_number || 'unavailable');

    }
  });

  updater.getEngineStatus(function(err, status) {
    if(err) {
            $('.label-engine-status').removeClass('info-up').addClass('info-down').text("down");      
    } else {
            $('.label-engine-status').removeClass('info-down').addClass('info-up').text(status.state);      
    }
  });

});
