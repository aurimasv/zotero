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


/*
 * Primary interface for accessing Zotero feed items
 */
Zotero.FeedItems = function() {
	// Don't extend Zotero.Items, just provide a proxy, so we use a single cache
	// All code dealing explicitly and solely with feeds should use
	// Zotero.FeedItems API instead of Zotero.Items
	var Zotero_FeedItems = function() {
		// Modify Zotero.Items to support FeedItems
		
		// Load additional primary data
		var additionalParts = {
			feedItemGUID: "FeI.guid AS feedItemGUID",
			feedItemReadTimestamp: "FeI.readTimestamp AS feedItemReadTimestamp"
		};
		// The getter for _primaryDataSQLParts MUST NOT have been called yet or this
		// won't work, because some other lateInit properties may have been called
		// and would be out of sync. Shouldn't really be an issue.
		let descriptor = Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(Zotero.Items),
			'_primaryDataSQLParts'
		);
		Zotero.defineProperty(Zotero.Items, '_primaryDataSQLParts', {
			get: function() {
				let parts = descriptor.get.call(Zotero.Items);
				for (let i in additionalParts) {
					parts[i] = additionalParts[i];
				}
				return parts;
			},
			set: descriptor.set,
			enumerable: descriptor.enumerable,
			configurable: descriptor.configurable // But this would fail anyway if it were false
		}, {lateInit: true} );
		
		// Join additional tables
		Zotero.Items._primaryDataSQLFrom += " LEFT JOIN feedItems FeI ON (FeI.itemID=O.itemID)";
		
		// Choose correct item type when loading from DB row
		Zotero.Items._getObjectForRow = function(row) {
			if (row.feedItemGUID) {
				return new Zotero.FeedItem();
			}
			
			return new Zotero.Item();
		}
	};
	
	Zotero_FeedItems.prototype._idCache = {};
	Zotero_FeedItems.prototype._guidCache = {};
	Zotero_FeedItems.prototype.getIDFromGUID = Zotero.Promise.coroutine(function* (guid) {
		if (this._idCache[guid] !== undefined) return this._idCache[guid];
		
		id = yield Zotero.DB.valueQueryAsync('SELECT itemID FROM feedItems WHERE guid=?', [guid]);
		if (!id) return false;
		
		this._setGUIDMapping(guid, id);
		return id;
	});
	
	Zotero_FeedItems.prototype._setGUIDMapping = function(guid, id) {
		this._idCache[guid] = id;
		this._guidCache[id] = guid;
	};
	
	Zotero_FeedItems.prototype._deleteGUIDMapping = function(guid, id) {
		if (!id) id = this._idCache[guid];
		if (!guid) guid = this._guidCache[id];
		
		if (!guid || !id) return;
		
		delete this._idCache[guid];
		delete this._guidCache[id];
	};
	
	Zotero_FeedItems.prototype.unload = function() {
		Zotero.Items.unload.apply(Zotero.Items, arguments);
		let ids = Zotero.flattenArguments(arguments);
		for (let i=0; i<ids.length; i++) {
			this._deleteGUIDMapping(null, ids[i]);
		}
	};
	
	Zotero_FeedItems.prototype.getAsyncByGUID = Zotero.Promise.coroutine(function* (guid) {
		let id = yield this.getIDFromGUID(guid);
		if (id === false) return false;
		
		return Zotero.Items.getAsync(id);
	});
	
	var feedItems = new Zotero_FeedItems();
	
	// Proxy remaining methods/properties to Zotero.Items
	for (let i in Zotero.Items) {
		if (feedItems.hasOwnProperty(i)) continue;
		
		let prop = i;
		Zotero.defineProperty(feedItems, prop, {
			get: function() {
				let val = Zotero.Items[prop];
				if (typeof val == 'function') return val.bind(Zotero.Items);
				return val;
			},
			set: function(val) Zotero.Items[prop] = val
		});
	}
	
	return feedItems;
}();