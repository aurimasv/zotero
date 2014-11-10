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
	var Zotero_FeedItems = function() {
		Zotero_FeedItems._super.apply(this);
	}
	
	Zotero.extendClass(Zotero.Items.constructor, Zotero_FeedItems);
	
	Zotero_FeedItems.prototype._ZDO_object = 'feedItem';
	Zotero_FeedItems.prototype._ZDO_id = 'itemID';
	
	Zotero.defineProperty(Zotero_FeedItems.prototype, '_primaryDataSQLParts', {
		get: function() {
			var _primaryDataSQLParts = Zotero.Utilities.deepCopy(Zotero.Items._primaryDataSQLParts);
			_primaryDataSQLParts.feedItemGUID = "FeI.guid AS feedItemGUID";
			_primaryDataSQLParts.feedItemReadTimestamp = "FeI.readTimestamp AS feedItemReadTimestamp";
			return _primaryDataSQLParts;
		}
	}, {lateInit: true});
	
	Zotero_FeedItems.prototype._primaryDataSQLFrom = Zotero_FeedItems._super.prototype._primaryDataSQLFrom
		+ " LEFT JOIN feedItems FeI ON (FeI.itemID=O.itemID)";
	
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
		Zotero_FeedItems._super.prototype.unload.apply(this, arguments);
		let ids = Zotero.flattenArguments(arguments);
		for (let i=0; i<ids.length; i++) {
			this._deleteGUIDMapping(null, ids[i]);
		}
	};
	
	Zotero_FeedItems.prototype.getAsyncByGUID = Zotero.Promise.coroutine(function* (guid) {
		let id = yield this.getIDFromGUID(guid);
		if (id === false) return false;
		
		return this.getAsync(id);
	});
	
	return new Zotero_FeedItems();
}();