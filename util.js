var path = require('path');
var log = require('./log').logger('util');
var fs = require('fs');
var fs = require('fs');
var uuid = require('node-uuid');
var fs = require('fs');
var escapeRE = require('escape-regexp-component');
var exec = require('child_process').exec;
var Q = require('q');
var http = require('http');
var mime = require('mime');
var restify = require('restify');
var errors = restify.errors;

var MethodNotAllowedError = errors.MethodNotAllowedError;
var NotAuthorizedError = errors.NotAuthorizedError;
var ResourceNotFoundError = errors.ResourceNotFoundError;

function retry(fn, retries, timeout) {
    retries = retries || 0;
    timeout = timeout || 0;

    return function() {
        return fn().then(function(data) {
            return data;
        }, function(err) {
            if(retries  === 0) {
                throw err;
            }
            if(err) { log.warn(err); }
            if(timeout) {
                log.warn('Retrying after ' + timeout + 'ms...');
            } else {
                log.warn('Retrying...');
            }
            return Q.delay(timeout).then(function() {
                return retry(fn, retries-1, timeout)();
            });
        });
    }
}


function listify(x) {
    if(x instanceof Array) {
        return x;
    } else {
        return [x];
    }
}

function doshell(command, callback){
    exec(command, function(error, stdout, stderr) {
        callback(stdout);
    });
}

/*
 * Conduct the specified shell operation, and return a promise that resolves upon completion of the command.
 * If the command was successful (0 error code) the promise resolves with all the stdout data from the process.
 * If the command fails (nonzero error code) the promise rejects with all the stderr data from the process.
 */
function doshell_promise(command, options) {
    var deferred = Q.defer();
    options = options || {};

    if(!options.silent) {
        log.command(command);
    }
    try {
        exec(command, options, function(err, stdout, stderr) {
            if(!options.silent) {
                log.stdout(stdout);
                log.stderr(stderr);
            }
            if(err) {
                deferred.reject(err);
            } else {
                deferred.resolve(stdout);
            }
        });
    } catch(e) {
        deferred.reject(e);
    }

    return deferred.promise;
}

function extend(a,b, force) {
    for(k in b) {
        if(a.hasOwnProperty(k) || force) {
            if(typeof b[k] === 'object' && b[k] !== null) {
                if(typeof a[k] === 'object' && a[k] !== null) {
                    extend(a[k], b[k]);
                } else {
                    if(force) {
                        a[k] = b[k];
                    } else {
                        log.warn('Object format error in extend.');
                    }
                }
            } else {
                a[k] = b[k];
            }
        }
    }
}

exports.filename = function(pathname) {
    parts = pathname.split(path.sep);
    return parts[parts.legnth-1];
};

var createUniqueFilename = function (filename) {
    var extension = (/[.]/.exec(filename)) ? /[^.]+$/.exec(filename) : undefined;
    return uuid.v1() + (extension ? ('.' + extension) : '');
};

// Simple queue, faster than using array.shift
function Queue(){

  var queue  = [];
  var offset = 0;

  this.getLength = function(){ return (queue.length - offset); };
  this.getContents = function() { return queue; };
  this.isEmpty = function(){ return (queue.length === 0); };
  this.enqueue = function(item){ queue.push(item); };
  this.dequeue = function(){

    // if the queue is empty, return immediately
    if (queue.length === 0) return undefined;

    // store the item at the front of the queue
    var item = queue[offset];

    // increment the offset and remove the free space if necessary
    if (++ offset * 2 >= queue.length){
      queue  = queue.slice(offset);
      offset = 0;
    }

    // return the dequeued item
    return item;

  };
  this.multiDequeue = function(count) {

    // If asking for more items than are in the queue, return everything
    count = count > queue.length ? queue.length : count;

    // store the item at the front of the queue
    var items = queue.slice(offset, offset+count);

    // add to the offset and remove the free space if necessary
    offset += count;
    if (offset * 2 >= queue.length){
      queue  = queue.slice(offset);
      offset = 0;
    }

    // return the dequeued item
    return items;

  };

  this.peek = function(){
    return (queue.length > 0 ? queue[offset] : undefined);
  };
  this.clear = function() {
	queue = [];
	offset = 0;
	};
}

/**
 * Move a file from src to dest, avoiding cross-device rename failures.
 * This method will first try fs.rename and call the supplied callback if it succeeds. Otherwise
 * it will pump the content of src into dest and unlink src upon completion.
 *
 * This might take a little more time than a single fs.rename, but it avoids error when
 * trying to rename files from one device to the other.
 */
var move = function (src, dest, cb) {
	var renameDeferred = q.defer();

	fs.rename(src, dest, function (err) {
		if (err) {
			renameDeferred.reject(err);
		}
		else {
			renameDeferred.resolve();
		}
	});

	renameDeferred.promise.then(function () {
		// rename worked
		return cb(null);
	}, function (err) {

		log.warn('io.move: standard rename failed, trying stream pipe... (' + err + ')');

		// rename didn't work, try pumping
		var is = fs.createReadStream(src),
			os = fs.createWriteStream(dest);

		is.pipe(os);

		is.on('end', function () {
			fs.unlinkSync(src);
			cb(null);
		});

		is.on('error', function (err) {
			return cb(err);
		});

		os.on('error', function (err) {
			return cb(err);
		});
	});
};

function serveStatic(opts) {
    opts = opts || {};
    /*
    assert.object(opts, 'options');
    assert.string(opts.directory, 'options.directory');
    assert.optionalNumber(opts.maxAge, 'options.maxAge');
    assert.optionalObject(opts.match, 'options.match');
    assert.optionalString(opts.charSet, 'options.charSet');
    */

    var p = path.normalize(opts.directory).replace(/\\/g, '/');
    var re = new RegExp('^' + escapeRE(p) + '/?.*');

    function serveFileFromStats(file, err, stats, isGzip, req, res, next) {
        if (err) {
            next(new ResourceNotFoundError(err,
                req.path()));
            return;
        } else if (!stats.isFile()) {
            next(new ResourceNotFoundError('%s does not exist', req.path()));
            return;
        }

        if (res.handledGzip && isGzip) {
            res.handledGzip();
        }

        var fstream = fs.createReadStream(file + (isGzip ? '.gz' : ''));
        var maxAge = opts.maxAge === undefined ? 3600 : opts.maxAge;
        fstream.once('open', function (fd) {
            res.cache({maxAge: maxAge});
            res.set('Content-Length', stats.size);
            res.set('Content-Type', mime.lookup(file));
            res.set('Last-Modified', stats.mtime);
            if (opts.charSet) {
                var type = res.getHeader('Content-Type') +
                    '; charset=' + opts.charSet;
                res.setHeader('Content-Type', type);
            }
            if (opts.etag) {
                res.set('ETag', opts.etag(stats, opts));
            }
            res.writeHead(200);
            fstream.pipe(res);
            fstream.once('end', function () {
                next(false);
            });
        });
    }

    function serveNormal(file, req, res, next) {
        fs.stat(file, function (err, stats) {
            if (!err && stats.isDirectory() && opts.default) {
                // Serve an index.html page or similar
                file = path.join(file, opts.default);
                fs.stat(file, function (dirErr, dirStats) {
                    serveFileFromStats(file,
                        dirErr,
                        dirStats,
                        false,
                        req,
                        res,
                        next);
                });
            } else {
                serveFileFromStats(file,
                    err,
                    stats,
                    false,
                    req,
                    res,
                    next);
            }
        });
    }

    function serve(req, res, next) {
        var uricomp = decodeURIComponent(req.path());
        var file = path.join(opts.directory, uricomp);

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next(new MethodNotAllowedError(req.method));
            return;
        }

        if (!re.test(file.replace(/\\/g, '/'))) {
            next(new NotAuthorizedError(req.path()));
            return;
        }

        if (opts.match && !opts.match.test(file)) {
            next(new NotAuthorizedError(req.path()));
            return;
        }

        if (opts.gzip && req.acceptsEncoding('gzip')) {
            fs.stat(file + '.gz', function (err, stats) {
                if (!err) {
                    res.setHeader('Content-Encoding', 'gzip');
                    serveFileFromStats(file,
                        err,
                        stats,
                        true,
                        req,
                        res,
                        next);
                } else {
                    serveNormal(file, req, res, next);
                }
            });
        } else {
            serveNormal(file, req, res, next);
        }

    }

    return (serve);
}

// TODO better error handling here
function walkDir(filename) {
    var stats = fs.lstatSync(filename),
        info = {
            path: filename,
            text: path.basename(filename),
            name: path.basename(filename)
        };

    if (stats.isDirectory()) {
        info.type = "dir";
        info.children = fs.readdirSync(filename).map(function(child) {
            return walkDir(filename + '/' + child);
        });
    } else {
        // Assuming it's a file. In real life it could be a symlink or
        // something else!
        info.type = "file";
        info.children = null;
    }

    return info;
}

function fixJSON(json) {
    var retval = {};

    for(var key in json) {
        if (typeof json[key] === 'object') {
            var value = fixJSON(json[key]);
        } else {
            var value = Number(json[key]);
            if(typeof value === 'undefined' || isNaN(value)) {
                if(json[key] === 'true') {
                    value = true;
                } else if(json[key] === 'false') {
                    value = false;
                } else {
                    value = json[key];
                }
            }
        }
        if(key[0] === '_') {
            key = key.slice(1);
        }
        retval[key] = value;
    }
    return retval;
}
var getClientAddress = function (req) {
        return (req.headers['x-forwarded-for'] || '').split(',')[0]
        || req.connection.remoteAddress;
};

function eject(command, args) {
    var child = require('child_process').spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    process.exit(0);
}

exports.getClientAddress = getClientAddress;
exports.serveStatic = serveStatic;
exports.Queue = Queue;
exports.move = move;
exports.walkDir = walkDir;
exports.createUniqueFilename = createUniqueFilename;
exports.fixJSON = fixJSON;
exports.extend = extend;
exports.doshell = doshell;
exports.doshell_promise = doshell_promise;
exports.eject = eject;
exports.retry = retry;
