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

Zotero.defineProperty(Zotero.Feed.prototype, 'url', {
	get: function() this._feedUrl,
	set: function(val) this._feedUrl = val
})
Zotero.defineProperty(Zotero.Feed.prototype, 'refreshInterval', {
	get: function() this._feedRefreshInterval,
	set: function(val) this._feedRefreshInterval = val
})
Zotero.defineProperty(Zotero.Feed.prototype, 'cleanupAfter', {
	get: function() this._feedCleanupAfter,
	set: function(val) this._feedCleanupAfter = val
})
Zotero.defineProperty(Zotero.Feed.prototype, 'libraryID', {
	get: function() Zotero.Libraries.feedLibraryID
})

Zotero.Feed.prototype.loadFromRow = function(row) {
	Zotero.debug('Loading feed-specific data');
	for (let field in row) {
		if (!feed.indexOf('feed') == 0) continue;
		let prop = '_' + field[5].toLowerCase() + field.substr(6);
		switch(field) {
			case 'feedUrl':
			case 'feedLastCheckError':
				this[prop] = row[field];
				break;
			case 'feedCleanupAfter':
			case 'feedRefreshInterval':
			case 'feedUnreadCount':
				this[prop] = parseInt(row[field]);
				break;
			case 'feedLastCheck':
				let val = row[field] || null;
				if (val) val = Zotero.Date.sqlToDate(val, true);
				this[prop] = val;
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
		'lastCheck',
		'lastCheckError',
		'refreshInterval',
		'cleanupAfter'
	];
	var sqlValues = [
		{ int: env.id },
		{ string: this.url },
		this._feedLastCheck ? Zotero.Date.dateToSQL(this._feedLastCheck, true) : null,
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