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
	
	Zotero_Feeds._super = Zotero.Collections.constructor;
	Zotero_Feeds.prototype = Object.create(Zotero_Feeds._super.prototype);
	Zotero_Feeds.prototype.constructor = Zotero_Feeds; // This is the only way to access the class from the singleton
	
	Zotero_Feeds.prototype._ZDO_object = 'feed';
	Zotero_Feeds.prototype._ZDO_id = 'collectionID';
	
	var _primaryDataSQLParts = Zotero.Utilities.deepCopy(Zotero_Feeds._super.prototype._primaryDataSQLParts);
	_primaryDataSQLParts.feedUrl = "FeD.url AS feedUrl";
	_primaryDataSQLParts.feedLastCheck = "FeD.lastCheck AS feedLastCheck";
	_primaryDataSQLParts.feedLastCheckError = "FeD.lastCheckError AS feedLastCheckError";
	_primaryDataSQLParts.feedCleanupAfter = "FeD.cleanupAfter AS feedCleanupAfter";
	_primaryDataSQLParts.feedRefreshInterval = "FeD.refreshInterval AS feedRefreshInterval";
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
	
	return new Zotero_Feeds();
}()

