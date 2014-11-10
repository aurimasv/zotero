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
 * Primary interface for accessing Zotero collection
 */
Zotero.Feeds = function() {
	var Zotero_Feeds = function() {
		Zotero_Feeds._super.apply(this);
	}
	
	Zotero.extendClass(Zotero.Collections.constructor, Zotero_Feeds);
	
	Zotero_Feeds.prototype._ZDO_object = 'feed';
	Zotero_Feeds.prototype._ZDO_id = 'collectionID';
	
	var _primaryDataSQLParts = Zotero.Utilities.deepCopy(Zotero_Feeds._super.prototype._primaryDataSQLParts);
	_primaryDataSQLParts.feedUrl = "FeD.url AS feedUrl";
	_primaryDataSQLParts.feedLastUpdate = "FeD.lastUpdate AS feedLastUpdate";
	_primaryDataSQLParts.feedLastCheck = "FeD.lastCheck AS feedLastCheck";
	_primaryDataSQLParts.feedLastCheckError = "FeD.lastCheckError AS feedLastCheckError";
	_primaryDataSQLParts.feedCleanupAfter = "FeD.cleanupAfter AS feedCleanupAfter"; // Days
	_primaryDataSQLParts.feedRefreshInterval = "FeD.refreshInterval AS feedRefreshInterval"; // Minutes
	_primaryDataSQLParts.feedUnreadCount = "(SELECT COUNT(*) "
		+ "FROM collectionItems CI LEFT JOIN feedItems FeID USING (itemID) "
		+ "WHERE CI.collectionID=O.collectionID AND FeID.readTimestamp IS NULL) "
		+ "AS feedUnreadCount";
	
	Zotero_Feeds.prototype._primaryDataSQLParts = _primaryDataSQLParts;
	
	Zotero_Feeds.prototype._primaryDataSQLFrom = Zotero_Feeds._super.prototype._primaryDataSQLFrom
		+ " LEFT JOIN feeds FeD USING (collectionID)";
	
	Zotero_Feeds.prototype.add = function() {
		throw new Error('Zotero.Feeds.add must not be used. Use new Zotero.Feed instead');
	};
	
	Zotero_Feeds.prototype.haveFeeds = Zotero.Promise.coroutine(function* () {
		let sql = "SELECT COUNT(*) FROM feeds";
		let count = yield Zotero.DB.valueQueryAsync(sql);
		return count ? !!parseInt(count) : count;
	});
	
	Zotero_Feeds.prototype.getFeedsInLibrary = Zotero.Promise.coroutine(function* () {
		let sql = "SELECT collectionID AS id FROM feeds";
		let ids = yield Zotero.DB.queryAsync(sql);
		let feeds = yield this.getAsync(ids.map(function(row) row.id));
		if (!feeds.length) return feeds;
		
		return feeds.sort(function (a, b) Zotero.localeCompare(a.name, b.name));
	});
	
	let globalFeedCheckDelay = Zotero.Promise.resolve(),
		pendingFeedCheckSchedule;
	Zotero_Feeds.prototype.scheduleNextFeedCheck = Zotero.Promise.coroutine(function* () {
return;
		Zotero.debug("Scheduling next feed update.");
		let sql = "SELECT ( CASE "
			+ "WHEN lastCheck IS NULL THEN 0 "
			+ "ELSE julianday(lastCheck, 'utc') + (refreshInterval/1440) - julianday('now', 'utc') "
			+ "END ) * 1440 AS nextCheck "
			+ "FROM feeds WHERE refreshInterval IS NOT NULL "
			+ "ORDER BY nextCheck ASC LIMIT 1";
		var nextCheck = yield Zotero.DB.valueQueryAsync(sql);
		
		if (this._nextFeedCheck) {
			this._nextFeedCheck.cancel();
			this._nextFeedCheck = null;
		}
		
		if (nextCheck !== false) {
			nextCheck = nextCheck > 0 ? Math.ceil(nextCheck * 60000) : 0;
			Zotero.debug("Next feed check in " + nextCheck/60000 + " minutes");
			this._nextFeedCheck = Zotero.Promise.delay(nextCheck)
				.cancellable();
			Zotero.Promise.all([this._nextFeedCheck, globalFeedCheckDelay])
			.then(() => {
				globalFeedCheckDelay = Zotero.Promise.delay(60000); // Don't perform auto-updates more than once per minute
				return this.updateFeeds()
			});
		} else {
			Zotero.debug("No feeds with auto-update.");
		}
	});
	
	Zotero_Feeds.prototype.updateFeeds = Zotero.Promise.coroutine(function* () {
		let sql = "SELECT collectionID AS id FROM feeds "
			+ "WHERE refreshInterval IS NOT NULL "
			+ "AND ( lastCheck IS NULL "
				+ "OR (julianday(lastCheck, 'utc') + (refreshInterval/1440) - julianday('now', 'utc')) <= 0 )";
		let needUpdate = (yield Zotero.DB.queryAsync(sql)).map(row => row.id);
		Zotero.debug("Running update for feeds: " + needUpdate.join(', '));
		let feeds = yield this.getAsync(needUpdate);
		let updatePromises = [];
		for (let i=0; i<feeds.length; i++) {
			updatePromises.push(feeds[i]._updateFeed());
		}
		
		return Zotero.Promise.settle(updatePromises)
		.then(() => {
			Zotero.debug("All feed updates done.");
			this.scheduleNextFeedCheck()
		});
	});
	
	Zotero_Feeds.prototype.erase = function(ids) {
		ids = Zotero.flattenArguments(ids);
		
		return Zotero.DB.executeTransaction(function* () {
			for (let i=0; i<ids.length; i++) {
				let id = ids[i];
				let feed = yield this.getAsync(id);
				if (!feed) {
					Zotero.debug('Feed ' + id + ' does not exist in Feeds.erase()!', 1);
					continue;
				}
				yield feed.erase(); // calls unload()
			}
		}.bind(this));
	};
	
	Zotero_Feeds.prototype.refreshChildItems = Zotero.Promise.coroutine(function* () {
		// Also invalidate collection cache
		yield Zotero.Collections.refreshChildItems.apply(Zotero.Collections, arguments);
		yield Zotero_Feeds._super.prototype.refreshChildItems.apply(this, arguments);
	});
		
	
	return new Zotero_Feeds();
}()

