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

Zotero.Feed = function() {
	Zotero.Feed._super.apply(this);
	
	this._feedUrl = null;
	this._feedLastUpdate = null;
	this._feedLastCheck = null;
	this._feedLastCheckError = null;
	this._feedCleanupAfter = null;
	this._feedRefreshInterval = null;
	this._feedUnreadCount = null;
}

Zotero.Feed._super = Zotero.Collection;
Zotero.Feed.prototype = Object.create(Zotero.Feed._super.prototype);
Zotero.Feed.constructor = Zotero.Feed;

Zotero.Feed.prototype._objectType = 'feed';

Zotero.defineProperty(Zotero.Feed.prototype, 'isFeed', {
	value: true
});

Zotero.defineProperty(Zotero.Feed.prototype, 'url', {
	get: function() this._feedUrl,
	set: function(val) this._set('url',val)
})
Zotero.defineProperty(Zotero.Feed.prototype, 'refreshInterval', {
	get: function() this._feedRefreshInterval,
	set: function(val) this._set('refreshInterval',val)
})
Zotero.defineProperty(Zotero.Feed.prototype, 'cleanupAfter', {
	get: function() this._feedCleanupAfter,
	set: function(val) this._set('cleanupAfter',val)
})
Zotero.defineProperty(Zotero.Feed.prototype, 'lastCheck', {
	get: function() this._feedLastCheck,
	set: function(val) this._set('lastCheck',val)
})
Zotero.defineProperty(Zotero.Feed.prototype, 'lastUpdate', {
	get: function() this._feedLastUpdate,
	set: function(val) this._set('lastUpdate',val)
})
Zotero.defineProperty(Zotero.Feed.prototype, 'lastCheckError', {
	get: function() this._feedLastCheckError,
	set: function(val) this._set('lastCheckError',val)
})
Zotero.defineProperty(Zotero.Feed.prototype, 'libraryID', {
	get: function() Zotero.Libraries.feedLibraryID
})

Zotero.Feed.prototype._set = function (field, value) {
	switch (field) {
		case 'url':
		case 'lastUpdate':
		case 'lastCheck':
			break;
		case 'refreshInterval':
		case 'cleanupAfter':
			value = parseInt(value);
			if (!value || value < 0) val = null;
			break;
		case 'lastCheckError':
			if (!value) value = null;
			break;
		default:
			return Zotero.Feed._super.prototype._set.apply(this, arguments);
	}
	
	this._requireData('primaryData');
	
	let prop = '_feed' + field[0].toUpperCase() + field.substr(1);
	if (this[prop] != value) {
		this._markFieldChange(field, this[prop]);
		this._changed.primaryData = true;
		
		this[prop] = value;
	}
}

Zotero.Feed.prototype.loadFromRow = function(row) {
	Zotero.debug('Loading feed-specific data');
	for (let field in row) {
		if (field.indexOf('feed') != 0) continue;
		let prop = '_' + field;
		switch(field) {
			case 'feedUrl':
			case 'feedLastCheckError':
			case 'feedLastCheck':
			case 'feedLastUpdate':
				this[prop] = row[field];
				break;
			case 'feedCleanupAfter':
			case 'feedRefreshInterval':
			case 'feedUnreadCount':
				this[prop] = parseInt(row[field]);
				break;
		}
	}
	
	Zotero.Feed._super.prototype.loadFromRow.apply(this, [row]);
}

Zotero.Feed.prototype._initSave = Zotero.Promise.coroutine(function* (env) {
	if (!this.url) {
		throw new Error('Feed URL is not set');
	}
	
	return Zotero.Feed._super.prototype._initSave.apply(this, arguments);
});

Zotero.Feed.prototype._saveData = Zotero.Promise.coroutine(function* (env) {
	yield Zotero.Feed._super.prototype._saveData.apply(this, arguments);
	
	Zotero.debug("Saving feed data for collection " + this.id);
	
	var columns = [
		'collectionID',
		'url',
		'lastUpdate',
		'lastCheck',
		'lastCheckError',
		'refreshInterval',
		'cleanupAfter'
	];
	var sqlValues = [
		{ int: env.id },
		{ string: this.url },
		this._feedLastUpdate,
		this._feedLastCheck,
		this._feedLastCheckError,
		this.refreshInterval,
		this.cleanupAfter
	];
	
	if (env.isNew) {
		var placeholders = columns.map(function () '?').join();
		
		var sql = "REPLACE INTO feeds (" + columns.join(', ') + ") "
			+ "VALUES (" + placeholders + ")";
		yield Zotero.DB.queryAsync(sql, sqlValues);
	}
	else {
		columns.shift();
		sqlValues.push(sqlValues.shift());
		let sql = 'UPDATE feeds SET '
			+ columns.map(function (x) x + '=?').join(', ')
			+ ' WHERE collectionID=?';
		yield Zotero.DB.queryAsync(sql, sqlValues);
	}
})

Zotero.Feed.prototype.getExpiredFeedItemIDs = Zotero.Promise.coroutine(function* () {
	let sql = "SELECT itemID AS id FROM feedItems "
		+ "WHERE readTimestamp IS NOT NULL "
		+ "AND (julianday(readTimestamp, 'utc') + (?) - julianday('now', 'utc')) > 0";
	let expiredIDs = yield Zotero.DB.queryAsync(sql, [{int: this.cleanupAfter}]);
	return expiredIDs.map(row => row.id);
});

Zotero.Feed.prototype._updateFeed = Zotero.Promise.coroutine(function* () {
	let errorMessage = '';
	try {
		// Clear expired items
		if (this.cleanupAfter) {
			let expiredItems = yield this.getExpiredFeedItemIDs();
			Zotero.debug("Cleaning up read feed items...");
			if (expiredItems.length) {
				Zotero.debug(expiredItems.join(', '));
				yield Zotero.FeedItems.erase(expiredItems);
			} else {
				Zotero.debug("No expired feed items");
			}
		}
	} catch(e) {
		Zotero.debug("Error clearing expired feed items.");
		Zotero.debug(e);
	}
	
	try {
		let fr = new Zotero.FeedReader(this.url);
		let itemIterator = fr.createItemIterator();
		let item, toAdd = [], processedGUIDs = [];
		while (item = yield itemIterator.next().value) {
			if (item.dateModified && this.lastUpdate
				&& item.dateModified < this.lastUpdate
			) {
				Zotero.debug("Item modification date before last update date (" + this._feedLastCheck + ")");
				Zotero.debug(item);
				// We can stop now
				fr.terminate();
				break;
			}
			
			if (processedGUIDs.indexOf(item.guid) != -1) {
				Zotero.debug("Feed item " + item.guid + " already processed from feed.");
				continue;
			}
			processedGUIDs.push(item.guid);
			
			Zotero.debug("New feed item retrieved:");
			Zotero.debug(item);
			
			let feedItem = yield Zotero.FeedItems.getAsyncByGUID(item.guid);
			if (!feedItem) {
				feedItem = new Zotero.FeedItem();
				feedItem.guid = item.guid;
				feedItem.setCollections([this.id]);
			} else {
				Zotero.debug("Feed item " + item.guid + " already in library.");
				if (item.dateModified && feedItem.dateModified
					&& feedItem.dateModified == item.dateModified
				) {
					Zotero.debug("Modification date has not changed. Skipping update.");
					continue;
				}
				Zotero.debug("Updating metadata");
				yield feedItem.loadItemData();
				yield feedItem.loadCreators();
				feedItem.isRead = false;
			}
			
			// Delete invalid data
			delete item.guid;
			
			feedItem.fromJSON(item);
			toAdd.push(feedItem);
		}
		
		// Save in reverse order
		let savePromises = new Array(toAdd.length);
		for (let i=toAdd.length-1; i>=0; i--) {
			yield toAdd[i].save({skipEditCheck: true, setDateModified: true});
		}
		
		this.lastUpdate = Zotero.Date.dateToSQL(new Date(), true);
	} catch(e) {
		Zotero.debug("Error processing feed from " + this.url);
		Zotero.debug(e);
		errorMessage = e.message || 'Error processing feed';
	}
	
	this.lastCheck = Zotero.Date.dateToSQL(new Date(), true);
	this.lastCheckError = errorMessage || null;
	yield this.save({skipEditCheck: true});
});

Zotero.Feed.prototype.updateFeed = function() {
	return this._updateFeed()
	.finally(function() {
		Zotero.Feeds.scheduleNextFeedCheck();
	});
}

Zotero.Feed.prototype.erase = Zotero.Promise.coroutine(function* () {
	yield this.loadChildItems();
	let childItemIDs = this.getChildItems(true, true);
	yield Zotero.FeedItems.erase(childItemIDs);
	return Zotero.Feed._super.prototype.erase.call(this); // Don't tell it to delete child items. They're already gone
})