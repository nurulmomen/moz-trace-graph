/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Main display for trace contents.
 */
function TraceGraph(element) {
  this.element = element;
  this.document = element.ownerDocument;

  this._bounds = new TraceBounds();

  this.element.addEventListener("overflow", this._onResize.bind(this));
  this.element.addEventListener("wheel", this._onWheel.bind(this));

  EventEmitter.decorate(this);
};

TraceGraph.prototype = {
  setTrace: function(trace) {
    this._trace = trace;
    this._bounds.setTrace(trace);

    while (this.element.hasChildNodes()) {
      this.element.removeChild(this.element.firstChild);
    }

    this._mainView = new MainView(this, this._bounds);
    this._overview = new Overview(this, this._bounds);
    this._mainView.setTrace(trace);
    this._overview.setTrace(trace);

    this._onResize();
  },

  refresh: function() {
    this._mainView._requestRender();
    this._overview._requestRender();
  },

  _onResize: function() {
    var rect = this.element.getBoundingClientRect();
    var overviewHeight = (rect.height / 4) | 0;

    this._mainView.resize(rect.width, rect.height - overviewHeight);
    this._overview.resize(rect.width, overviewHeight);
  },

  _onWheel: function(ev) {
    ev.preventDefault();

    if (!this._trace || !this._trace.finished) {
      return;
    }

    var trace  = this._trace;
    var bounds = this._bounds;

    var dx = ev.deltaX;
    var dy = ev.deltaY;

    if (Math.abs(dy) > Math.abs(dx)) {
      bounds.zoom(dy);
    } else {
      bounds.pan(dx);
    }
  }
};


function TraceBounds() {
  EventEmitter.decorate(this);
}

TraceBounds.prototype = {
  _minimumIntervalTime: 3,

  get _minimumIntervalWidth() {
    return this._minimumIntervalTime / this._totalTime;
  },

  get left()          { return this._left; },
  set left(percent)   { this.setBounds(percent, this._right); },

  get right()         { return this._right; },
  set right(percent)  { this.setBounds(this._left, percent); },

  get center()        { return this._left + this.intervalWidth / 2; },
  set center(percent) {
    var width = Math.max(this.intervalWidth, this._minimumIntervalWidth) / 2;
    if (percent < width) {
      percent = width;
    } else if (percent > 1.0 - width) {
      percent = 1.0 - width;
    }
    this.setBounds(percent - width, percent + width);
  },

  get leftTime()      { return this._totalTime * this._left; },
  set leftTime(time)  { this.setBounds(time / this._totalTime, this._right); },

  get rightTime()     { return this._totalTime * this._right; },
  set rightTime(time) { this.setBounds(this._left, time / this._totalTime); },

  get intervalWidth() { return this._right - this._left; },
  get intervalTime()  { return this.rightTime - this.leftTime; },

  setTrace: function(trace) {
    this._totalTime = trace.totalTime;
    this._left = 0.0;
    this._right = 1.0;
  },

  setBounds: function(left, right, why) {
    if (left > right) {
      [left, right] = [right, left];
    }
    this._left  = Math.max(Math.min(left || 0, 1.0), 0.0);
    this._right = Math.max(Math.min(right || 1, 1.0), 0.0);

    this.emit("changed", why);
  },

  percentageFromTime: function(time, inBounds) {
    if (inBounds) {
      return (time - this.leftTime) / this.intervalTime;
    }
    else {
      return time / this._totalTime;
    }
  },

  timeFromPercentage: function(percent, inBounds) {
    if (inBounds) {
      return this.leftTime + percent * this.intervalTime;
    }
    return percent * this._totalTime;
  },

  zoom: function(value) {
    var zoom = this.intervalWidth * value / 1000;
    var minWidth = this._minimumIntervalWidth;
    if (this.intervalWidth + 2 * zoom < minWidth) {
      var center = this.center;
      this.setBounds(center - minWidth / 2, center + minWidth / 2, "zoom");
    } else {
      this.setBounds(this._left - zoom, this._right + zoom, "zoom");
    }
  },

  pan: function(value) {
    this.panByPercent(value / 1000);
  },

  panByPercent: function(value) {
    var pan = this.intervalWidth * value;
    var roomToPan = value < 0 ? -this._left : 1.0 - this._right;
    if (Math.abs(pan) > Math.abs(roomToPan)) {
      pan = roomToPan;
    }
    this.setBounds(this._left + pan, this._right + pan, "pan");
  }
};


function TraceView(graph, bounds) {
  var element = graph.element;
  var doc = element.ownerDocument;

  this._graph = graph;

  var canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  this._canvas = canvas;
  this._ctx = canvas.getContext("2d");

  var buffer = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  this._buffer = buffer;
  this._bufCtx = buffer.getContext('2d');

  this._requestRender = this._requestRender.bind(this);
  this._render = this._render.bind(this);
  this._onBoundsChanged = this._onBoundsChanged.bind(this);

  if (bounds) {
    this._bounds = bounds;
    this._bounds.on("changed", this._onBoundsChanged);
  }

  element.appendChild(canvas);
}

TraceView.prototype = {
  setTrace: function(trace) {
    if (!trace) {
      return;
    }
    this._trace = trace;
    this._requestRender();
  },

  resize: function(width, height) {
    var canvas = this._canvas, buffer = this._buffer;

    canvas.width = width;
    canvas.height = height;
    buffer.width = width;
    buffer.height = height;

    // render synchronously to avoid flickering
    this._render();
  },

  _requestRender: function() {
    if (!this._requestedRender) {
      this._requestedRender =
        window.requestAnimationFrame(this._render);
    }
  },

  _render: function() {
    this._requestedRender = false;
    if (!this._trace) {
      return;
    }
    this._doRender();
  },

  _doRender: function() {},

  _renderFrame: function(frame) {
    var ctx = this._ctx;
    var selected = frame.uid === this._selected;
    var color;

    if (selected) {
      color = "yellow";
    } else {
      if (!colors.has(frame.name)) {
        colors.set(frame.name, getColor());
      }
      color = colors.get(frame.name);
    }

    var [x, y, w, h] = this._frameRect(frame);

    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);

    if (this._showNames && w > 20) {
      var padding = 5;
      var maxWidth = (x < 0) ? w + x - padding : w - 2 * padding;
      var fontSize = Math.min(h-2, 12);
      var name = frame.name;

      if (maxWidth < 10) {
        return;
      }

      ctx.font = fontSize + "px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillStyle = selected ? "black" : "white";

      if (ctx.measureText(name).width > maxWidth) {
        while (ctx.measureText(name + "...").width > maxWidth) {
          name = name.substring(0, name.length-1);
        }
        name += "...";
        if (ctx.measureText(name).width > maxWidth || name.length === 3) {
          return;
        }
      }

      ctx.fillText(name, (x < 0 ? 0 : x) + padding, y + h/2, maxWidth);
    }
  },

  _frameRect: function(frame) {
    var trace  = this._trace;
    var bounds = this._bounds;
    var zoomed = this._isZoomView;
    var {width, height} = this._canvas;

    var x = width * bounds.percentageFromTime(frame.startTime, zoomed);
    var w = width * (frame.endTime
                     ? frame.totalTime / (zoomed ? bounds.intervalTime : trace.totalTime)
                     : 1.0);
    var h = height / trace.maxDepth;
    var y = height - (frame.depth + 1) * h;

    if (this._vGap && h > this._vGap) {
      h -= this._vGap;
    }

    return [x, y, w, h];
  },

  _onBoundsChanged: function(ev, why) {
    this._requestRender();
  }
};


function MainView(graph, bounds) {
  TraceView.call(this, graph, bounds);
  this._vGap = 2;
  this._isZoomView = true;
  this._showNames = true;

  var mousePressed, dragging, dragX;
  this._canvas.addEventListener("mousedown", (ev) => {
    mousePressed = true;
    dragX = ev.layerX;
  });
  this._canvas.addEventListener("mousemove", (ev) => {
    if (mousePressed) {
      dragging = true;
    }
    if (dragging) {
      this._bounds.panByPercent((dragX - ev.layerX) / this._canvas.width);
      dragX = ev.layerX;
    }
  });
  this._canvas.addEventListener("mouseup", (ev) => {
    if (mousePressed && !dragging) {
      this._onClick(ev);
    }
    mousePressed = false;
    dragging = false;
  });
  this._canvas.addEventListener("mouseout", () => {
    mousePressed = false;
    dragging = false;
  });
}

MainView.prototype = {
  _doRender: function() {
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._renderChildren(this._trace);
  },

  _renderChildren: function(frame) {
    var {leftTime, rightTime} = this._bounds;
    var children = frame.children;

    if (frame.totalTime === 0)
      return;

    var idx = binarySearch(leftTime, children,
                           function(time, child) { return time - child.endTime; });
    if (idx < 0) {
      idx = -(idx + 1);
    }
    var firstVisibleChild = children[idx];
    if (!firstVisibleChild) {
      return;
    }

    for (var i = idx; i < children.length; ++i) {
      var child = children[i];
      if (child.startTime > rightTime) {
        break;
      }
      this._renderFrame(child);
      this._renderChildren(child);
    }
  },

  _onClick: function(ev) {
    var trace  = this._trace;
    var bounds = this._bounds;
    var frames = trace.frames;
    var children = trace.children;
    var {width, height} = this._canvas;

    var x = ev.layerX;
    var y = ev.layerY;
    var time = bounds.timeFromPercentage(x / width, true);
    var depth = ((height - y) / (height / trace.maxDepth)) | 0;

    var idx = binarySearch(time, children, function(time, frame) {
      if (frame.startTime > time) {
        return -1;
      } else if (frame.endTime < time) {
        return 1;
      } else {
        return 0;
      }
    });
    if (idx < 0) {
      idx = -(idx + 1);
    }

    var childUid = children[idx].uid;
    var nextUid = children[idx+1] ? children[idx+1].uid : frames.length;

    for (var i = childUid; i < nextUid; ++i) {
      var frame = frames[i];
      if (frame.depth === depth
          && frame.startTime <= time
          && frame.endTime >= time) {
        if (this._selected === frame.uid) {
          break;
        }
        this._selected = frame.uid;
        this._graph.refresh();
        this._graph.emit("select", frame.uid);
        break;
      }
    }
  },

  __proto__: TraceView.prototype
};


function Overview(graph, bounds) {
  TraceView.call(this, graph, bounds);
  this._bufferStale = true;

  this._canvas.addEventListener("mousedown", (ev) => {
    this._dragging = true;
    this._recenter(ev);
  });
  this._canvas.addEventListener("mousemove", (ev) => {
    if (this._dragging) {
      this._recenter(ev);
    }
  });
  this._canvas.addEventListener("mouseup", () => {
    this._dragging = false;
  });
  this._canvas.addEventListener("mouseout", () => {
    this._dragging = false;
  });
}

Overview.prototype = {
  resize: function(width, height) {
    this._bufferStale = true;
    TraceView.prototype.resize.call(this, width, height);
  },

  _requestRender: function() {
    if (this._trace && this._trace.finished) {
      TraceView.prototype._requestRender.call(this);
    }
  },

  _doRender: function() {
    var bounds = this._bounds;
    var {width, height} = this._canvas;

    if (this._bufferStale) {
      // render frames to canvas
      this._ctx.clearRect(0, 0, width, height);
      this._ctx.fillStyle = "rgb(200, 200, 200)";
      this._ctx.fillRect(0, 0, width, height);
      for (var frame of this._trace.frames) {
        this._renderFrame(frame);
      }

      var doc = this._graph.document;
      var buffer = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      this._buffer = buffer;

      // copy canvas to offscreen buffer
      buffer.width  = width;
      buffer.height = height;
      buffer.getContext('2d').drawImage(this._canvas,
                                        0, 0, width, height,
                                        0, 0, width, height );
      this._bufferStale = false;
    } else {
      // render buffer to canvas
      this._ctx.drawImage(this._buffer,
                          0, 0, width, height,
                          0, 0, width, height );
    }

    var left = width * bounds.left;
    var right = width * bounds.right;

    this._ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    this._ctx.fillRect(0, 0, left, height);
    this._ctx.fillRect(right, 0, width - right, height);
  },

  _recenter: function(ev) {
    this._bounds.center = ev.layerX / this._canvas.width;
  },

  __proto__: TraceView.prototype
};


var h = { min:  0, max: 360, step: 43 };
var s = { min: 30, max:  40, step:  3 };
var l = { min: 20, max:  40, step:  5 };

var current = { h: h.max, s: s.max, l: l.max };

function getColor() {
  if ((current.h -= h.step) <= h.min) current.h += h.max;
  if ((current.s -= s.step) <= s.min) current.s += s.max;
  if ((current.l -= l.step) <= l.min) current.l += l.max;
  return "hsl("+current.h+", "+current.s+"%, "+current.l+"%)";
}

var colors = new Map();


function binarySearch(key, array, comparator) {
  var first = 0;
  var last = array.length - 1;

  while (first <= last) {
    var mid = (first + last) >> 1;
    var c = comparator(key, array[mid]);

    if (c > 0) {
      first = mid + 1;
    } else if (c < 0) {
      last = mid - 1;
    } else {
      return mid;
    }
  }

  return -(first + 1);
}