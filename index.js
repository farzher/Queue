// Generated by LiveScript 1.2.0
var mongodb, MongoClient, _, async, request, fs, Path, Url, db, collection, dbConfig, queues, defaultQueueConfig, jobValidation, Job, Queue, refreshDbConfig, createJob, promoteJobs, configFile, exists, configFileAbsPath, configObject, e, express, app, bodyParser, router, toString$ = {}.toString;
mongodb = require('mongodb');
MongoClient = mongodb.MongoClient;
_ = require('prelude-ls-extended');
async = require('async');
request = require('request');
fs = require('fs');
Path = require('path');
Url = require('url');
db = collection = dbConfig = null;
queues = {};
defaultQueueConfig = {
  priority: 0,
  limit: 0,
  rateLimit: 0,
  rateInterval: 0,
  attempts: 1,
  backoff: 0,
  delay: 0,
  duration: 60 * 60,
  url: null,
  method: 'POST',
  onSuccessDelete: false
};
jobValidation = {
  data: 'obj',
  type: 'str',
  priority: 'int',
  attempts: '+int',
  backoff: '',
  delay: 'int',
  url: '',
  method: 'str',
  batchId: '_id',
  parentId: '_id',
  isOnBatchComplete: 'bool',
  onSuccessDelete: 'bool',
  onComplete: 'obj'
};
Job = (function(){
  Job.displayName = 'Job';
  var prototype = Job.prototype, constructor = Job;
  function Job(model){
    this.model = model != null
      ? model
      : {};
    this.data = this.model.data;
    this.queue = queues[this.model.type];
  }
  prototype.option = function(it){
    var that;
    switch (false) {
    case (that = this.model[it]) == null:
      return that;
    default:
      return this.queue.options[it];
    }
  };
  prototype.update = function(data, next){
    import$(this.model, data);
    collection.update({
      _id: this.model._id
    }, {
      $set: data
    }, next);
  };
  prototype.setState = function(state, next){
    var updateData, backoff, backoffType, attempt, doc, backoffValue, e, this$ = this;
    next == null && (next = function(){});
    if (this.model.state !== state) {
      this.queue.processingCount -= 1;
    }
    updateData = {};
    if (state === 'failed') {
      updateData.failedAttempts = (this.model.failedAttempts || 0) + 1;
      if (this.option('attempts') <= 0 || updateData.failedAttempts < this.option('attempts')) {
        state = 'pending';
        backoff = this.option('backoff');
        backoffType = toString$.call(backoff).slice(8, -1);
        if ((backoffType === 'Number' && backoff > 0) || backoffType === 'String') {
          state = 'delayed';
          if (backoffType === 'String') {
            try {
              attempt = updateData.failedAttempts;
              doc = this.model;
              backoffValue = Number(eval(backoff));
            } catch (e$) {
              e = e$;
              backoffValue = 0;
              state = 'killed';
            }
          } else {
            backoffValue = backoff;
          }
          updateData.delayTil = Date.now() + backoffValue * 1000;
        }
      }
    }
    this.update((updateData.state = state, updateData), function(err){
      (function(next){
        var ref$;
        if (this$.model.onComplete && (state === 'killed' || state === 'failed' || state === 'success')) {
          createJob((ref$ = this$.model.onComplete, ref$.batchId = this$.model.batchId, ref$.parentId = this$.model._id, ref$), next);
        } else {
          next();
        }
      })(function(){
        (function(next){
          if (this$.model.batchId && !this$.model.isOnBatchComplete && (state === 'killed' || state === 'failed' || state === 'success')) {
            this$.checkBatchFinish(next);
          } else {
            next();
          }
        })(function(){
          if (state === 'success' && this$.option('onSuccessDelete')) {
            this$['delete']();
          }
          next(err);
        });
      });
    });
  };
  prototype.checkBatchFinish = function(next){
    var this$ = this;
    next == null && (next = function(){});
    collection.find({
      batchId: this.model.batchId,
      state: {
        $nin: ['killed', 'failed', 'success']
      },
      isOnBatchComplete: {
        $ne: true
      }
    }).count(function(err, count){
      if (count === 0) {
        collection.update({
          batchId: this$.model.batchId,
          isOnBatchComplete: true
        }, {
          $set: {
            delayTil: Date.now()
          }
        }, {
          multi: true
        }, function(err){
          promoteJobs();
          next();
        });
      } else {
        next();
      }
    });
  };
  prototype.success = function(result, job){
    var this$ = this;
    console.log('done success: ', result);
    (function(next){
      var updateData;
      updateData = {};
      if (this$.model.progress != null) {
        updateData.progress = 100;
      }
      if (result != null) {
        updateData.result = result;
      }
      if (!_.Obj.empty(updateData)) {
        this$.update(updateData, next);
      } else {
        next();
      }
    })(function(){
      (function(next){
        if (job) {
          createJob((job.batchId = this$.model.batchId, job.parentId = this$.model._id, job), next);
        } else {
          next();
        }
      })(function(){
        this$.setState('success', function(err){
          this$.queue.processPendingJobs();
        });
      });
    });
  };
  prototype.error = function(msg, o){
    var m, this$ = this;
    o == null && (o = {
      process: true
    });
    m = 'Error';
    if (msg) {
      m += ": " + msg;
    }
    this.log(m);
    console.log('done', m);
    this.setState('failed', function(err){
      if (o.process) {
        this$.queue.processPendingJobs();
      }
    });
  };
  prototype.systemError = function(msg, o){
    this.error("SYSTEM ERROR: " + msg, o);
  };
  prototype.retry = function(msg){
    var m;
    m = 'Retry';
    if (msg) {
      m += ": " + msg;
    }
    this.log(m);
    console.log('done', m);
    this.setState('pending');
  };
  prototype.kill = function(msg){
    var m;
    m = 'Killed';
    if (msg) {
      m += ": " + msg;
    }
    this.log(m);
    console.log('done', m);
    this.setState('killed');
  };
  prototype['delete'] = function(){
    var this$ = this;
    collection.remove({
      _id: this.model._id
    }, function(err){
      if (err) {
        this$.log('Delete Failed');
      }
    });
  };
  prototype.log = function(message, next){
    next == null && (next = function(){});
    collection.update({
      _id: this.model._id
    }, {
      $push: {
        logs: {
          t: Date.now(),
          m: message
        }
      }
    }, next);
  };
  prototype.progress = function(progress, next){
    next == null && (next = function(){});
    this.update({
      progress: progress
    }, next);
  };
  prototype.create = createJob;
  prototype.getBatchJobs = function(next){
    var this$ = this;
    collection.find({
      batchId: this.model.batchId,
      isOnBatchComplete: {
        $ne: true
      }
    }).toArray(function(err, docs){
      var jobs, res$, i$, len$, data;
      if (err) {
        return this$.systemError(err);
      }
      res$ = [];
      for (i$ = 0, len$ = docs.length; i$ < len$; ++i$) {
        data = docs[i$];
        res$.push(new Job(data));
      }
      jobs = res$;
      next(jobs);
    });
  };
  prototype.getParentJob = function(next){
    var this$ = this;
    collection.find({
      _id: this.parentId
    }).toArray(function(err, docs){
      var job;
      if (err) {
        return this$.systemError(err);
      }
      job = new Job(docs[0]);
      next(job);
    });
  };
  return Job;
}());
Job.create = function(model, next){
  var delay, ref$, ref1$, k, v;
  model.type == null && (model.type = 'default');
  model.state = 'pending';
  delay = model.delay || ((ref$ = queues[model.type]) != null ? (ref1$ = ref$.options) != null ? ref1$.delay : void 8 : void 8) || 0;
  if (delay > 0) {
    model.state = 'delayed';
    model.delayTil = Date.now() + delay * 1000;
  } else if (delay < 0) {
    model.state = 'delayed';
  }
  for (k in model) {
    v = model[k];
    if (v === undefined) {
      delete model[k];
    }
  }
  console.log(model);
  collection.insert(model, function(err, docs){
    var job;
    console.log('inserted new job to:', model.type);
    job = new Job(docs[0]);
    next(err, job);
  });
};
Queue = (function(){
  Queue.displayName = 'Queue';
  var prototype = Queue.prototype, constructor = Queue;
  function Queue(type, options){
    this.type = type;
    options == null && (options = {});
    this.updateConfig(options);
    this.processingCount = 0;
    this.processPendingJobs();
  }
  prototype.updateConfig = function(options){
    this.options = import$(import$({}, dbConfig.queues['default']), options);
  };
  prototype.processPendingJobs = function(){
    var this$ = this;
    if (this.processingCount < 0) {
      this.processingCount = 0;
    }
    console.log('processingCount:', this.type, this.processingCount);
    if (this.options.limit > 0 && this.processingCount >= this.options.limit) {
      return;
    }
    this.processingCount += 1;
    (function(next){
      if (this$.options.rateLimit > 0 && this$.options.rateInterval > 0) {
        collection.find({
          lastProcessed: {
            $gte: Date.now() - this$.options.rateInterval * 1000
          }
        }).count(function(err, count){
          if (count < this$.options.rateLimit) {
            next();
          } else {
            return this$.processingCount -= 1;
          }
        });
      } else {
        next();
      }
    })(function(){
      var resetAt;
      resetAt = Date.now() + (this$.options.duration || 0) * 1000;
      collection.findAndModify({
        type: this$.type,
        state: 'pending'
      }, [['priority', 'desc']], {
        $set: {
          state: 'processing',
          lastProcessed: Date.now(),
          resetAt: resetAt
        }
      }, {
        'new': true
      }, function(err, doc){
        var job;
        job = doc ? new Job(doc) : null;
        if (!job) {
          return this$.processingCount -= 1;
        }
        this$.process(job);
        this$.processPendingJobs();
      });
    });
  };
  prototype.process = function(job){
    var url, type, that;
    url = job.option('url');
    type = job.option('type');
    if (url) {
      console.log('pushing job to:', url);
      request({
        url: url,
        method: job.option('method'),
        json: job.model
      }, function(err, res, body){
        var msg;
        console.log('url done!');
        if (err) {
          return job.kill(err);
        }
        msg = res.statusCode + "" + (body ? ": " + body : "");
        if (res.statusCode === 200) {
          job.success(body);
        } else if (res.statusCode === 202) {
          job.retry(msg);
        } else if (res.statusCode === 403) {
          job.kill(msg);
        } else {
          job.systemError(msg);
        }
      });
    } else if (that = configObject.process[type]) {
      console.log('config process found:', type);
      that(job);
    } else {
      console.log('no process defined for this job:', job);
    }
  };
  return Queue;
}());
refreshDbConfig = function(){
  db.collection('config').findOne(function(err, _dbConfig){
    var k, ref$, v, that;
    dbConfig = _dbConfig;
    if (dbConfig == null) {
      dbConfig = {
        queues: {
          'default': defaultQueueConfig
        }
      };
      db.collection('config').insert(dbConfig, function(err, docs){});
    }
    for (k in ref$ = dbConfig.queues) {
      v = ref$[k];
      if ((that = queues[k]) != null) {
        that.updateConfig(v);
      } else {
        queues[k] = new Queue(k, v);
      }
    }
  });
};
createJob = function(obj, next){
  var validateJobErr, isArray, jobs, batchId, onComplete, i$, len$, job, that;
  next == null && (next = function(){});
  validateJobErr = function(it){
    var k, v, validation;
    if (toString$.call(it).slice(8, -1) !== 'Object') {
      return "Job must be an object";
    }
    for (k in it) {
      v = it[k];
      if (v === undefined) {
        delete it[k];
        continue;
      }
      validation = jobValidation[k];
      if (validation == null) {
        return "Unknown job key `" + k + "`";
      }
      if (validation === '_id' && toString$.call(v).slice(8, -1) === 'String') {
        it[k] = v = mongodb.ObjectID(v);
      }
      switch (validation) {
      case 'bool':
        if (toString$.call(v).slice(8, -1) !== 'Boolean') {
          return "Key `" + k + "` must be an bool";
        }
        break;
      case 'int':
        if (v !== parseInt(v)) {
          return "Key `" + k + "` must be an int";
        }
        break;
      case '+int':
        if (v !== parseInt(v) || v <= 0) {
          return "Key `" + k + "` must be a positive int";
        }
        break;
      case 'str':
        if (toString$.call(v).slice(8, -1) !== 'String') {
          return "Key `" + k + "` must be a str";
        }
        break;
      case 'obj':
        if (toString$.call(v).slice(8, -1) !== 'Object') {
          return "Key `" + k + "` must be an obj";
        }
        break;
      case '_id':
        if (toString$.call(v).slice(8, -1) !== 'Object') {
          return "Key `" + k + "` must be an ObjectId";
        }
      }
    }
  };
  isArray = _.isArray(obj);
  if (isArray || obj.jobs != null) {
    jobs = isArray
      ? obj
      : obj.jobs;
    batchId = obj.batchId;
    onComplete = obj.onComplete;
    if (onComplete != null) {
      if (!_.isArray(onComplete)) {
        onComplete = [onComplete];
      }
      for (i$ = 0, len$ = onComplete.length; i$ < len$; ++i$) {
        job = onComplete[i$];
        job.delay = -1;
        job.isOnBatchComplete = true;
        jobs.push(job);
      }
    }
    if (toString$.call(jobs).slice(8, -1) !== 'Array') {
      return next('Jobs must be an array');
    }
    if (_.empty(jobs)) {
      return next('Array of jobs is empty');
    }
    for (i$ = 0, len$ = jobs.length; i$ < len$; ++i$) {
      job = jobs[i$];
      if (that = validateJobErr(job)) {
        console.log('validateJobErr', that);
        return next(that);
      }
    }
    (function(next){
      if (!batchId) {
        db.collection('batches').insert({}, function(err, docs){
          batchId = docs[0]._id;
          next();
        });
      } else {
        next();
      }
    })(function(){
      async.each(jobs, function(model, next){
        Job.create((model.batchId = batchId, model.parentId = obj.parentId, model), next);
      }, function(err){
        var i$, ref$, len$, type, ref1$;
        for (i$ = 0, len$ = (ref$ = _.unique(_.map(fn$, jobs))).length; i$ < len$; ++i$) {
          type = ref$[i$];
          if ((ref1$ = queues[type]) != null) {
            ref1$.processPendingJobs();
          }
        }
        next(err);
        function fn$(it){
          return it.type;
        }
      });
    });
  } else {
    if (that = validateJobErr(obj)) {
      console.log('validateJobErr', that);
      return next(that);
    }
    Job.create(obj, function(err, job){
      var ref$;
      if (job.model.state === 'pending') {
        if ((ref$ = job.queue) != null) {
          ref$.processPendingJobs();
        }
      }
      next(err);
    });
  }
};
promoteJobs = function(){
  var processed, i$, ref$, queue;
  processed = [];
  for (i$ in ref$ = queues) {
    queue = ref$[i$];
    if (queue.options.rateLimit > 0 && queue.options.rateInterval > 0) {
      processed.push(queue.type);
      queue.processPendingJobs();
    }
  }
  collection.find({
    state: 'delayed',
    delayTil: {
      $lte: Date.now()
    }
  }, {
    _id: true,
    type: true
  }).toArray(function(err, delayedDocs){
    var _ids;
    _ids = _.map(function(it){
      return it._id;
    }, delayedDocs);
    collection.update({
      _id: {
        $in: _ids
      }
    }, {
      $set: {
        state: 'pending'
      }
    }, {
      multi: true
    }, function(err){
      collection.find({
        state: 'processing',
        resetAt: {
          $lte: Date.now()
        }
      }).toArray(function(err, hangingDocs){
        var i$, len$, model, job, docs, ref$, type, ref1$;
        for (i$ = 0, len$ = hangingDocs.length; i$ < len$; ++i$) {
          model = hangingDocs[i$];
          job = new Job(model);
          job.systemError('Hanging job detected. Job is processing for too long');
        }
        docs = delayedDocs.concat(hangingDocs);
        if (_.empty(docs)) {
          return;
        }
        for (i$ = 0, len$ = (ref$ = _.unique(_.reject((fn$), _.map(fn1$, docs)))).length; i$ < len$; ++i$) {
          type = ref$[i$];
          if ((ref1$ = queues[type]) != null) {
            ref1$.processPendingJobs();
          }
        }
        function fn$(it){
          return in$(it, processed);
        }
        function fn1$(it){
          return it.type;
        }
      });
    });
  });
};
configFile = process.argv[2];
exists = fs.existsSync(configFile);
if (!exists) {
  throw 'Config file must exist';
}
configFileAbsPath = Path.join(process.cwd(), configFile);
configObject = (function(){
  try {
    return require(configFileAbsPath);
  } catch (e$) {
    e = e$;
    throw e;
  }
}());
if (!configObject.connect) {
  throw 'connect string is required in config file';
}
configObject.port == null && (configObject.port = 5672);
configObject.promoteInterval == null && (configObject.promoteInterval = 5000);
configObject.process == null && (configObject.process = {});
MongoClient.connect(configObject.connect, function(err, _db){
  console.log('Connected');
  db = _db;
  collection = db.collection('jobs');
  refreshDbConfig();
  collection.ensureIndex({
    type: 1
  }, function(){
    collection.ensureIndex({
      state: 1
    }, function(){
      collection.ensureIndex({
        priority: 1
      }, function(){
        collection.ensureIndex({
          delayTil: 1
        }, function(){
          collection.ensureIndex({
            resetAt: 1
          }, function(){
            collection.ensureIndex({
              batchId: 1
            }, function(){
              collection.ensureIndex({
                parentId: 1
              }, function(){
                setInterval(promoteJobs, configObject.promoteInterval);
                promoteJobs();
              });
            });
          });
        });
      });
    });
  });
});
express = require('express');
app = express();
bodyParser = require('body-parser');
app.use(bodyParser.json());
router = express.Router();
router.all('/', function(req, res){
  res.send('//TODO: Single page UI that lets you see what jobs are currently running, and edit queue settings');
});
router.all('/job', function(req, res){
  createJob(req.body, function(err){
    res.status(err ? 500 : 200);
    res.send(err);
  });
});
router.all('/refresh-db-config', function(req, res){
  refreshDbConfig();
  res.send('');
});
app.use('/', router);
app.listen(configObject.port);
function import$(obj, src){
  var own = {}.hasOwnProperty;
  for (var key in src) if (own.call(src, key)) obj[key] = src[key];
  return obj;
}
function in$(x, xs){
  var i = -1, l = xs.length >>> 0;
  while (++i < l) if (x === xs[i]) return true;
  return false;
}