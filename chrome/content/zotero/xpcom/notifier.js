/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

Zotero.Notifier = new function(){
	var _observers = {};
	var _disabled = false;
	var _types = [
		'collection', 'search', 'share', 'share-items', 'item', 'file',
		'collection-item', 'item-tag', 'tag', 'setting', 'group', 'trash', 'bucket',
		'relation', 'feedItem', 'feed'
	];
	var _inTransaction;
	var _locked = false;
	var _queue = [];
	
	this.registerObserver = registerObserver;
	this.unregisterObserver = unregisterObserver;
	this.untrigger = untrigger;
	this.begin = begin;
	this.reset = reset;
	this.disable = disable;
	this.enable = enable;
	this.isEnabled = isEnabled;
	
	
	function registerObserver(ref, types, id) {
		if (types){
			types = Zotero.flattenArguments(types);
			
			for (var i=0; i<types.length; i++){
				if (_types.indexOf(types[i]) == -1){
					throw ('Invalid type ' + types[i] + ' in registerObserver()');
				}
			}
		}
		
		var len = 2;
		var tries = 10;
		do {
			// Increase the hash length if we can't find a unique key
			if (!tries){
				len++;
				tries = 10;
			}
			
			var hash = (id ? id + '_' : '') + Zotero.randomString(len);
			tries--;
		}
		while (_observers[hash]);
		
		Zotero.debug('Registering observer for '
			+ (types ? '[' + types.join() + ']' : 'all types')
			+ ' in notifier with hash ' + hash + "'", 4);
		_observers[hash] = {ref: ref, types: types};
		return hash;
	}
	
	function unregisterObserver(hash){
		Zotero.debug("Unregistering observer in notifier with hash '" + hash + "'", 4);
		delete _observers[hash];
	}
	
	/**
	* Trigger a notification to the appropriate observers
	*
	* Possible values:
	*
	* 	event: 'add', 'modify', 'delete', 'move' ('c', for changing parent),
	*		'remove' (ci, it), 'refresh', 'redraw', 'trash'
	* 	type - 'collection', 'search', 'item', 'collection-item', 'item-tag', 'tag', 'group', 'relation'
	* 	ids - single id or array of ids
	*
	* Notes:
	*
	* - If event queuing is on, events will not fire until commit() is called
	* unless _force_ is true.
	*
	* - New events and types should be added to the order arrays in commit()
	**/
	this.trigger = Zotero.Promise.coroutine(function* (event, type, ids, extraData, force) {
		if (_disabled){
			Zotero.debug("Notifications are disabled");
			return false;
		}
		
		if (_types && _types.indexOf(type) == -1){
			throw ('Invalid type ' + type + ' in Notifier.trigger()');
		}
		
		ids = Zotero.flattenArguments(ids);
		
		var queue = _inTransaction && !force;
		
		Zotero.debug("Notifier.trigger('" + event + "', '" + type + "', " + '[' + ids.join() + '], ' + extraData + ')'
			+ (queue ? " queued" : " called " + "[observers: " + Object.keys(_observers).length + "]"));
		if (extraData) {
			Zotero.debug("EXTRA DATA:");
			Zotero.debug(extraData);
		}
		
		// Merge with existing queue
		if (queue) {
			if (!_queue[type]) {
				_queue[type] = [];
			}
			if (!_queue[type][event]) {
				_queue[type][event] = {};
			}
			if (!_queue[type][event].ids) {
				_queue[type][event].ids = [];
				_queue[type][event].data = {};
			}
			
			// Merge ids
			_queue[type][event].ids = _queue[type][event].ids.concat(ids);
			
			// Merge extraData keys
			if (extraData) {
				Zotero.debug("ADDING EXTRA DATA");
				// If just a single id, extra data can be keyed by id or passed directly
				if (ids.length == 1) {
					let id = ids[0];
					_queue[type][event].data[id] = extraData[id] ? extraData[id] : extraData;
				}
				// For multiple ids, check for data keyed by the id
				else {
					for (let i = 0; i < ids.length; i++) {
						let id = ids[i];
						if (extraData[id]) {
							_queue[type][event].data[id] = extraData[id];
						}
					}
				}
			}
			Zotero.debug(_queue[type][event]);
			
			return true;
		}
		
		for (var i in _observers){
			Zotero.debug("Calling notify() with " + event + "/" + type + " on observer with hash '" + i + "'", 4);
			
			if (!_observers[i]) {
				Zotero.debug("Observer no longer exists");
				continue;
			}
			
			// Find observers that handle notifications for this type (or all types)
			if (!_observers[i].types || _observers[i].types.indexOf(type)!=-1){
				// Catch exceptions so all observers get notified even if
				// one throws an error
				try {
					yield Zotero.Promise.resolve(_observers[i].ref.notify(event, type, ids, extraData));
				}
				catch (e) {
					Zotero.debug(e);
					Components.utils.reportError(e);
				}
			}
		}
		
		return true;
	});
	
	
	function untrigger(event, type, ids) {
		if (!_inTransaction) {
			throw ("Zotero.Notifier.untrigger() called with no active event queue")
		}
		
		ids = Zotero.flattenArguments(ids);
		
		for each(var id in ids) {
			var index = _queue[type][event].ids.indexOf(id);
			if (index == -1) {
				Zotero.debug(event + '-' + type + ' id ' + id +
					' not found in queue in Zotero.Notifier.untrigger()');
				continue;
			}
			_queue[type][event].ids.splice(index, 1);
			delete _queue[type][event].data[id];
		}
	}
	
	
	/*
	 * Begin queueing event notifications (i.e. don't notify the observers)
	 *
	 * _lock_ will prevent subsequent commits from running the queue until commit() is called
	 * with the _unlock_ being true
	 *
	 * Note: Be sure the matching commit() gets called (e.g. in a finally{...} block) or
	 * notifications will break until Firefox is restarted or commit(true)/reset() is called manually
	 */
	function begin(lock) {
		if (lock && !_locked) {
			_locked = true;
			var unlock = true;
		}
		else {
			var unlock = false;
		}
		
		if (_inTransaction) {
			//Zotero.debug("Notifier queue already open", 4);
		}
		else {
			Zotero.debug("Beginning Notifier event queue");
			_inTransaction = true;
		}
		
		return unlock;
	}
	
	
	/*
	 * Send notifications for ids in the event queue
	 *
	 * If the queue is locked, notifications will only run if _unlock_ is true
	 */
	this.commit = Zotero.Promise.coroutine(function* (unlock) {
		// If there's a lock on the event queue and _unlock_ isn't given, don't commit
		if ((unlock == undefined && _locked) || (unlock != undefined && !unlock)) {
			//Zotero.debug("Keeping Notifier event queue open", 4);
			return;
		}
		
		var runQueue = [];
		
		function sorter(a, b) {
			return order.indexOf(b) - order.indexOf(a);
		}
		var order = ['collection', 'search', 'item', 'collection-item', 'item-tag', 'tag'];
		_queue.sort();
		
		var order = ['add', 'modify', 'remove', 'move', 'delete', 'trash'];
		var totals = '';
		for (var type in _queue) {
			if (!runQueue[type]) {
				runQueue[type] = [];
			}
			
			_queue[type].sort();
			
			for (var event in _queue[type]) {
				runQueue[type][event] = {
					ids: [],
					data: _queue[type][event].data
				};
				
				// Remove redundant ids
				for (var i=0; i<_queue[type][event].ids.length; i++) {
					var id = _queue[type][event].ids[i];
					
					// Don't send modify on nonexistent items or tags
					if (event == 'modify') {
						if (type == 'item' && !(yield Zotero.Items.getAsync(id))) {
							continue;
						}
						else if (type == 'tag' && !(yield Zotero.Tags.getAsync(id))) {
							continue;
						}
					}
					
					if (runQueue[type][event].ids.indexOf(id) == -1) {
						runQueue[type][event].ids.push(id);
					}
				}
				
				if (runQueue[type][event].ids.length || event == 'refresh') {
					totals += ' [' + event + '-' + type + ': ' + runQueue[type][event].ids.length + ']';
				}
			}
		}
		
		reset();
		
		if (totals) {
			Zotero.debug("Committing Notifier event queue" + totals);
			
			for (var type in runQueue) {
				for (var event in runQueue[type]) {
					if (runQueue[type][event].ids.length || event == 'refresh') {
						yield this.trigger(
							event,
							type,
							runQueue[type][event].ids,
							runQueue[type][event].data,
							true
						);
					}
				}
			}
		}
	});
	
	
	/*
	 * Reset the event queue
	 */
	function reset() {
		Zotero.debug("Resetting Notifier event queue");
		_locked = false;
		_queue = [];
		_inTransaction = false;
	}
	
	
	// 
	// These should rarely be used now that we have event queuing
	//
	
	/*
	 * Disables Notifier notifications
	 *
	 * Returns false if the Notifier was already disabled, true otherwise
	 */
	function disable() {
		if (_disabled) {
			Zotero.debug('Notifier notifications are already disabled');
			return false;
		}
		Zotero.debug('Disabling Notifier notifications'); 
		_disabled = true;
		return true;
	}
	
	
	function enable() {
		Zotero.debug('Enabling Notifier notifications');
		_disabled = false; 
	}
	
	
	function isEnabled() {
		return !_disabled;
	}
	/*
	 * Creates a queue that will hold notifier events until they are released
	 * 
	 * @method trigger    Delayed proxy for Zotero.Notifier.trigger
	 * @method untrigger  Delayed proxy for Zotero.Notifier.untrigger
	 * @method commit     Executes all queued notifier calls
	 * @method clearQueue Clear notifier call queue
	 */
	this.Queue = function() {
		var _queue = [];
		
		function queueAction() {
			_queue.push(arguments);
		}
		
		for (let i of ['trigger', 'untrigger']) {
			this[i] = queueAction.bind(null, i); // prepend method name to arguments
		}
		
		this.commit = function() {
			for (let i=0; i<_queue.length; i++) {
				let method = _queue[i][0];
				let args = Array.prototype.slice.call(_queue[i],1);
				Zotero.Notifier[method].apply(Zotero.Notifier, args);
			}
			this.clearQueue();
		}
		
		this.clearQueue = function() {
			_queue = [];
		}
	}
}
