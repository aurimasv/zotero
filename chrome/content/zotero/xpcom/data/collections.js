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
Zotero.Collections = function() {
	var Zotero_Collections = function() {
		Zotero_Collections._super.apply(this);
	}
	
	Zotero_Collections._super = Zotero.DataObjects;
	Zotero_Collections.prototype = Object.create(Zotero_Collections._super.prototype);
	Zotero_Collections.constructor = Zotero_Collections; // This is the only way to access the class from the singleton
	
	Zotero_Collections.prototype._ZDO_object = 'collection';
	
	Zotero_Collections.prototype._primaryDataSQLParts = {
		collectionID: "O.collectionID",
		name: "O.collectionName AS name",
		libraryID: "O.libraryID",
		key: "O.key",
		version: "O.version",
		synced: "O.synced",
		
		parentID: "O.parentCollectionID AS parentID",
		parentKey: "CP.key AS parentKey",
		
		hasChildCollections: "(SELECT COUNT(*) FROM collections WHERE "
			+ "parentCollectionID=O.collectionID) != 0 AS hasChildCollections",
		hasChildItems: "(SELECT COUNT(*) FROM collectionItems WHERE "
			+ "collectionID=O.collectionID) != 0 AS hasChildItems "
	};
	
	/**
	* Add new collection to DB and return Collection object
	*
	* _name_ is non-empty string
	* _parent_ is optional collectionID -- creates root collection by default
	*
	* Returns true on success; false on error
	**/
	Zotero_Collections.prototype.add = function (name, parent) {
		var col = new this.ObjectClass;
		col.name = name;
		col.parent = parent;
		var id = col.save();
		return this.getAsync(id);
	}
	
	
	/*
	 * Zotero.getCollections(parent)
	 *
	 * Returns an array of all collections are children of a collection
	 * as Zotero.Collection instances
	 *
	 * Takes parent collectionID as optional parameter;
	 * by default, returns root collections
	 */
	Zotero_Collections.prototype.getByParent = Zotero.Promise.coroutine(function* (libraryID, parent, recursive) {
		var toReturn = [];
		
		if (!parent) {
			parent = null;
		}
		
		var sql = "SELECT collectionID AS id, collectionName AS name FROM collections C "
			+ "WHERE libraryID=? AND parentCollectionID " + (parent ? '= ' + parent : 'IS NULL');
		var children = yield Zotero.DB.queryAsync(sql, [libraryID]);
		
		if (!children) {
			Zotero.debug('No child collections of collection ' + parent, 5);
			return toReturn;
		}
		
		// Do proper collation sort
		var collation = Zotero.getLocaleCollation();
		children.sort(function (a, b) {
			return collation.compareString(1, a.name, b.name);
		});
		
		for (var i=0, len=children.length; i<len; i++) {
			var obj = yield this.getAsync(children[i].id);
			if (!obj) {
				throw (this._ZDO_Object + ' ' + children[i].id + ' not found');
			}
			
			toReturn.push(obj);
			
			// If recursive, get descendents
			if (recursive) {
				var desc = obj.getDescendents(false, 'collection');
				for (var j in desc) {
					var obj2 = yield this.getAsync(desc[j]['id']);
					if (!obj2) {
						throw new Error(this._ZDO_Object + ' ' + desc[j] + ' not found');
					}
					
					// TODO: This is a quick hack so that we can indent subcollections
					// in the search dialog -- ideally collections would have a
					// getLevel() method, but there's no particularly quick way
					// of calculating that without either storing it in the DB or
					// changing the schema to Modified Preorder Tree Traversal,
					// and I don't know if we'll actually need it anywhere else.
					obj2.level = desc[j].level;
					
					toReturn.push(obj2);
				}
			}
		}
		
		return toReturn;
	});
	
	
	Zotero_Collections.prototype.getCollectionsContainingItems = function (itemIDs, asIDs) {
		// If an unreasonable number of items, don't try
		if (itemIDs.length > 100) {
			return Zotero.Promise.resolve([]);
		}
		
		var sql = "SELECT collectionID FROM collections WHERE ";
		var sqlParams = [];
		for each(var id in itemIDs) {
			sql += "collectionID IN (SELECT collectionID FROM collectionItems "
				+ "WHERE itemID=?) AND "
			sqlParams.push(id);
		}
		sql = sql.substring(0, sql.length - 5);
		return Zotero.DB.columnQueryAsync(sql, sqlParams)
		.then(collectionIDs => {
			return asIDs ? collectionIDs : this.get(collectionIDs);
		});
		
	}
	
	
	/**
	 * Invalidate child collection cache in specified collections, skipping any that aren't loaded
	 *
	 * @param	{Integer|Integer[]}	ids		One or more collectionIDs
	 */
	Zotero_Collections.prototype.refreshChildCollections = Zotero.Promise.coroutine(function* (ids) {
		ids = Zotero.flattenArguments(ids);
		
		for (let i=0; i<ids.length; i++) {
			let id = ids[i];
			if (this._objectCache[id]) {
				yield this._objectCache[id]._refreshChildCollections();
			}
		}
	});
	
	
	/**
	 * Invalidate child item cache in specified collections, skipping any that aren't loaded
	 *
	 * @param	{Integer|Integer[]}	ids		One or more itemIDs
	 */
	Zotero_Collections.prototype.refreshChildItems = Zotero.Promise.coroutine(function* (ids) {
		ids = Zotero.flattenArguments(ids);
		
		for (let i=0; i<ids.length; i++) {
			let id = ids[i];
			if (this._objectCache[id]) {
				yield this._objectCache[id]._refreshChildItems();
			}
		}
	});
	
	
	Zotero_Collections.prototype.erase = function (ids) {
		ids = Zotero.flattenArguments(ids);
		
		Zotero.DB.beginTransaction();
		for each(var id in ids) {
			var collection = this.getAsync(id);
			if (collection) {
				collection.erase();
			}
			collection = undefined;
		}
		
		this.unload(ids);
		
		Zotero.DB.commitTransaction();
	}
	
	
	Zotero_Collections.prototype.getPrimaryDataSQL = function () {
		// This should be the same as the query in Zotero.Collection.load(),
		// just without a specific collectionID
		return "SELECT "
			+ Object.keys(this._primaryDataSQLParts).map(key => this._primaryDataSQLParts[key]).join(", ") + " "
			+ "FROM collections O "
			+ "LEFT JOIN collections CP ON (O.parentCollectionID=CP.collectionID) "
			+ "WHERE 1";
	}
	
	return new Zotero_Collections();
}()

