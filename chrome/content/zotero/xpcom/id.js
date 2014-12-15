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

Zotero.ID_Tracker = function () {
	// Number of ids to compare against at a time
	Zotero.defineProperty(this, 'numIDs', {
		get: function () 10000
	});
	
	// Number of times to try increasing the maxID if first range fails
	Zotero.defineProperty(this, 'maxTries', {
		get: function () 3
	});
	
	// Total number of ids to find
	Zotero.defineProperty(this, 'maxToFind', {
		get: function () 1000
	});
	
	var _available = {};
	var _min = {};
	var _skip = {};
	
	var currentTransaction;
	
	/*
	 * Gets an unused primary key id for a DB table
	 */
	this.get = Zotero.Promise.coroutine(function* (table) {
		table = _getTableName(table);
		
		switch (table) {
			// Autoincrement tables
			case 'items':
			case 'creators':
			case 'creatorData':
			case 'collections':
			case 'savedSearches':
			case 'tags':
			case 'customItemTypes':
			case 'customFields':
			case 'itemDataValues':
				let id = yield _getNextAvailable(table);
				this.hold(table, id);
				return id;
			default:
				throw ("Unsupported table '" + table + "' in Zotero.ID.get()");
		}
	});
	
	/**
	 * Mark ids as used in the unlikely event that we need to reload the cache
	 * while some ids have been issued, but have not yet been written to the
	 * DB _and_ reloading the cache ends up re-visiting some ID blocks that it
	 * has already accessed from before (currently only possible for IDs grabbed
	 * from beyond the last issued ID _and_ only in the case where we exhausted
	 * maxTries)
	 */
	this.hold = function(table, ids) {
		table = _getTableName(table);
		
		if (!Array.isArray(ids)) {
			ids = [ids];
		}
		
		if (!_skip[table]) {
			_skip[table] = [];
		}
		
		for (var i=0, len=ids.length; i<len; i++) {
			let id = ids[i] * 1;
			if (Number.isNaN(id) || !Number.isInteger(id) || id <= 0) {
				Zotero.debug("Zotero.ID.hold: Ignoring invalid id " + id);
				continue;
			}
			
			Zotero.debug("Marking ID " + id + " for table " + table + " as taken.");
			_skip[table].push(id);
		}
		
		Zotero.debug(_skip[table].length + " IDs are on hold for table " + table);
	}
	
	this.release = function(table, ids) {
		table = _getTableName(table);
		
		if (!Array.isArray(ids)) {
			ids = [ids];
		}
		
		if (!_skip[table]) {
			Zotero.debug("No IDs are being held for table " + table);
			return;
		}
		
		for (var i=0, len=ids.length; i<len; i++) {
			let id = ids[i] * 1;
			if (Number.isNaN(id) || !Number.isInteger(id) || id <= 0) {
				Zotero.debug("Zotero.ID.release: Ignoring invalid id " + id);
				continue;
			}
			
			let index = _skip[table].indexOf(id);
			if (index == -1) continue;
			
			_skip[table].splice(index, 1);
		}
	}
	
	function _getTableName(table) {
		// Used in sync.js
		if (table == 'searches') {
			table = 'savedSearches';
		}
		
		switch (table) {
			case 'collections':
			case 'creators':
			case 'creatorData':
			case 'itemDataValues':
			case 'items':
			case 'savedSearches':
			case 'tags':
			case 'customItemTypes':
			case 'customFields':
				return table;
				
			default:
				throw ("Invalid table '" + table + "' in Zotero.ID");
		}
	}
	
	
	/*
	 * Returns the lowest available unused primary key id for table,
	 * or NULL if none could be loaded in _loadAvailable()
	 */
	var _getNextAvailable = Zotero.Promise.coroutine(function* (table) {
		if (!_available[table] || !_available[table].length) {
			yield _loadAvailable(table);
		}
		
		let range = _available[table][0];
		let id = range[0];
		
		range[0] = id + 1;
		if (range[0] > range[1]) {
			_available[table].splice(0,1);
		}
		
		return id;
	});
	
	
	/*
	 * Loads available ids for table into memory, enxuring that there are no
	 * concurrent attmepts to load IDs for the same table
	 */
	var _loadAvailable = Zotero.Promise.mutex(
		function(table) {
			return 'LoadAvailableIDs_' + table;
		},
		Zotero.Promise.coroutine(function* (table) {
			if (_available[table] && _available[table].length) return;
			
			Zotero.debug("Loading available ids for table '" + table + "'");
			
			var numIDs = Zotero.ID.numIDs; // Number of IDs to fetch at a time
			var tries = Zotero.ID.maxTries; // Number of tries to find gaps in IDs
			var maxToFind = Zotero.ID.maxToFind; // Max number of available IDs to cache
			
			var column = _getTableColumn(table);
			
			switch (table) {
				case 'creators':
				case 'creatorData':
				case 'items':
				case 'itemDataValues':
				case 'tags':
					break;
				
				case 'collections':
				case 'savedSearches':
				case 'customItemTypes':
				case 'customFields':
					var maxToFind = 100;
					break;
				
				default:
					throw ("Unsupported table '" + table + "' in Zotero.ID._loadAvailable()");
			}
			
			var sqlSelect = "SELECT " + column + " FROM " + table;
			var sql = sqlSelect
				+ " WHERE " + column + " BETWEEN ? AND ? ORDER BY " + column;
			
			var cache = [], // store ID blocks as [min, max] ranges
				found = 0,
				minID = _min[table] ? _min[table] + 1 : 1,
				skipIDs = _skip[table] || [],
				maxID, ids;
			while (found < maxToFind && tries-- > 0) {
				maxID = minID + numIDs - 1;
				ids = yield Zotero.DB.columnQueryAsync(sql, [minID, maxID]);
				
				let id;
				for (id = minID; id <= maxID && found < maxToFind; id++) {
					if (ids.indexOf(id) != -1 || skipIDs.indexOf(id) != -1) continue;
					
					found++;
					
					let lastRange = cache[cache.length - 1];
					if (lastRange && lastRange[1] + 1 == id) {
						lastRange[1] = id; // increment range max
					} else {
						// new range
						cache.push([id,id]);
					}
				}
				
				_min[table] = id; // if we hit maxToFind
				minID = maxID + 1;
			}
			
			if (found < maxToFind) {
				// Fetch remaining from the end of the table
				sql = sqlSelect + " ORDER BY " + column + " DESC LIMIT 1";
				var lastID = (yield Zotero.DB.valueQueryAsync(sql)) || 0;
				while (found < maxToFind) {
					if (skipIDs.indexOf(++lastID) != -1) continue;
					
					found++;
					
					let lastRange = cache[cache.length - 1];
					if (lastRange && lastRange[1] + 1 == lastID) {
						lastRange[1] = lastID; // increment range max
					} else {
						// new range
						cache.push([lastID,lastID]);
					}
				}
				
				if (tries > 0) {
					// We already checked all holes
					_min[table] = lastID + 1;
				}
			}
			
			_available[table] = cache;
			
			Zotero.debug("Loaded " + found + " available IDs for table " + table);
			Zotero.debug(cache);
		})
	);
	
	
	function _getTableColumn(table) {
		switch (table) {
			case 'itemDataValues':
				return 'valueID';
			
			case 'savedSearches':
				return 'savedSearchID';
			
			case 'creatorData':
				return 'creatorDataID';
			
			default:
				return table.substr(0, table.length - 1) + 'ID';
		}
	}
}

Zotero.ID = new Zotero.ID_Tracker;