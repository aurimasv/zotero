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
 * Constructor for FeedItem object
 */
Zotero.FeedItem = function(itemTypeOrID) {
	Zotero.FeedItem._super.apply(this);
	
	this._feedItemGUID = null;
	this._feedItemReadTimestamp = null;
}

Zotero.extendClass(Zotero.Item, Zotero.FeedItem)

Zotero.FeedItem.prototype._objectType = 'feedItem';
Zotero.FeedItem.prototype._containerObject = 'feed';

Zotero.defineProperty(Zotero.FeedItem.prototype, 'libraryID', {
	get: function() Zotero.Libraries.feedLibraryID
});
// make sure nothing changes the "private" property either
Zotero.defineProperty(Zotero.FeedItem.prototype, '_libraryID', {
	get: function() Zotero.Libraries.feedLibraryID
});

Zotero.defineProperty(Zotero.FeedItem.prototype, 'guid', {
	get: function() this._feedItemGUID,
	set: function(val) {
		if (this.id) throw new Error('Cannot set GUID after item ID is already set');
		if (!val || typeof val != 'string') throw new Error('GUID must be a non-empty string');
		if (this.guid == val) return;
		if (this.guid) throw new Error('GUID cannot be changed');
		this._feedItemGUID = val;
	}
});

Zotero.defineProperty(this, 'isRead', {
	get: function() {
		this._requireData('primaryData');
		return !!this._feedItemReadTimestamp;
	},
	set: function(read) {
		if (!read != !this._feedItemReadTimestamp) {
			// changed
			if (read) {
				this._feedItemReadTimestamp = Zotero.Date.dateToSQL(new Date(), true);
			} else {
				this._feedItemReadTimestamp = null;
			}
			this._changed.feedItemData = true;
		}
	}
});

Zotero.FeedItem.prototype.loadPrimaryData = Zotero.Promise.coroutine(function* (reload, failOnMissing) {
	if (this.guid && !this.id) {
		// fill in item ID
		this.id = yield this.ObjectsClass.getIDFromGUID(this.guid);
	}
	yield Zotero.FeedItem._super.prototype.loadPrimaryData.apply(this, arguments);
});

Zotero.FeedItem.prototype._initSave = Zotero.Promise.coroutine(function* (env) {
	if (!this.guid) {
		throw new Error('GUID must be set before saving ' + this._ObjectType);
	}
	
	if (!(yield Zotero.FeedItem._super.prototype._initSave.apply(this, arguments))) return false;
	
	// verify that GUID doesn't already exist for a new item
	if (env.isNew) {
		var item = yield this.ObjectsClass.getIDFromGUID(this.guid);
		if (item) {
			throw new Error('Cannot create new item with GUID ' + this.guid + '. Item already exists.');
		}
		
		// Register GUID => itemID mapping in cache on commit
		if (!env.transactionOptions) env.transactionOptions = {};
		var superOnCommit = env.transactionOptions.onCommit;
		env.transactionOptions.onCommit = () => {
			if (superOnCommit) superOnCommit();
			this.ObjectsClass._setGUIDMapping(this.guid, env.id);
		};
	}
	
	return true;
});

Zotero.FeedItem.prototype._saveData = Zotero.Promise.coroutine(function* (env) {
	yield Zotero.FeedItem._super.prototype._saveData.apply(this, arguments);
	
	if (this._changed.feedItemData || env.isNew) {
		var sql = "REPLACE INTO feedItems VALUES (?,?,?)";
		yield Zotero.DB.queryAsync(sql, [env.id, this.guid, this._feedItemReadTimestamp]);
		
		this._clearChanged('feedItemData');
	}
});
