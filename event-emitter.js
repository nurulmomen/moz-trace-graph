/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * EventEmitter.
 */

this.EventEmitter = function EventEmitter() {};

/**
 * Decorate an object with event emitter functionality.
 *
 * @param Object aObjectToDecorate
 *        Bind all public methods of EventEmitter to
 *        the aObjectToDecorate object.
 */
EventEmitter.decorate = function EventEmitter_decorate (aObjectToDecorate) {
  var emitter = new EventEmitter();
  aObjectToDecorate.on = emitter.on.bind(emitter);
  aObjectToDecorate.off = emitter.off.bind(emitter);
  aObjectToDecorate.once = emitter.once.bind(emitter);
  aObjectToDecorate.emit = emitter.emit.bind(emitter);
};

EventEmitter.prototype = {
  /**
   * Connect a listener.
   *
   * @param string aEvent
   *        The event name to which we're connecting.
   * @param function aListener
   *        Called when the event is fired.
   */
  on: function EventEmitter_on(aEvent, aListener) {
    if (!this._eventEmitterListeners)
      this._eventEmitterListeners = new Map();
    if (!this._eventEmitterListeners.has(aEvent)) {
      this._eventEmitterListeners.set(aEvent, []);
    }
    this._eventEmitterListeners.get(aEvent).push(aListener);
  },

  /**
   * Listen for the next time an event is fired.
   *
   * @param string aEvent
   *        The event name to which we're connecting.
   * @param function aListener
   *        Called when the event is fired.  Will be called at most one time.
   */
  once: function EventEmitter_once(aEvent, aListener) {
    var handler = function() {
      this.off(aEvent, handler);
      aListener.apply(null, arguments);
    }.bind(this);
    this.on(aEvent, handler);
  },

  /**
   * Remove a previously-registered event listener.  Works for events
   * registered with either on or once.
   *
   * @param string aEvent
   *        The event name whose listener we're disconnecting.
   * @param function aListener
   *        The listener to remove.
   */
  off: function EventEmitter_off(aEvent, aListener) {
    if (!this._eventEmitterListeners)
      return;
    var listeners = this._eventEmitterListeners.get(aEvent);
    if (listeners) {
      this._eventEmitterListeners.set(aEvent, listeners.filter(function(l) { return aListener != l; }));
    }
  },

  /**
   * Emit an event.  All arguments to this method will
   * be sent to listner functions.
   */
  emit: function EventEmitter_emit(aEvent) {
    if (!this._eventEmitterListeners || !this._eventEmitterListeners.has(aEvent))
      return;

    var originalListeners = this._eventEmitterListeners.get(aEvent);
    for (var key in originalListeners) {
      var listener = this._eventEmitterListeners.get(aEvent)[key];
      // If the object was destroyed during event emission, stop
      // emitting.
      if (!this._eventEmitterListeners) {
        break;
      }

      // If listeners were removed during emission, make sure the
      // event handler we're going to fire wasn't removed.
      if (originalListeners === this._eventEmitterListeners.get(aEvent) ||
          this._eventEmitterListeners.get(aEvent).some(function(l) { return l === listener; })) {
        try {
          listener.apply(null, arguments);
        }
        catch (ex) {
          // Prevent a bad listener from interfering with the others.
          var msg = ex + ": " + ex.stack;
          Cu.reportError(msg);
          dump(msg + "\n");
        }
      }
    }
  }
};
