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

Zotero.Relations = function () {
	var Zotero_Relations = function() {
		Zotero_Relations._super.apply(this);
	}
	
	Zotero_Relations._super = Zotero.DataObjects;
	Zotero_Relations.prototype = Object.create(Zotero_Relations._super.prototype);
	Zotero_Relations.constructor = Zotero_Relations; // This is the only way to access the class from the singleton
	
	Zotero_Relations.prototype._ZDO_object = 'relation';
	Zotero_Relations.prototype._ZDO_idOnly = true;
	
	Zotero.defineProperty(Zotero_Relations.prototype, 'relatedItemPredicate', {value: 'dc:relation'});
	Zotero.defineProperty(Zotero_Relations.prototype, 'linkedObjectPredicate', {value: 'owl:sameAs'});
	Zotero.defineProperty(Zotero_Relations.prototype, 'deletedItemPredicate', {value: 'dc:isReplacedBy'});
	
	Zotero_Relations.prototype.get = function (id) {
		if (typeof id != 'number') {
			throw ("id '" + id + "' must be an integer in Zotero." + this._ZDO_Objects + ".get()");
		}
		
		var relation = new this.ObjectClass;
		relation.id = id;
		return relation;
	}
	
	
	/**
	 * @return	{Object[]}
	 */
	Zotero_Relations.prototype.getByURIs = Zotero.Promise.coroutine(function* (subject, predicate, object) {
		if (predicate) {
			predicate = this._getPrefixAndValue(predicate).join(':');
		}
		
		if (!subject && !predicate && !object) {
			throw new Error("No values provided");
		}
		
		var sql = "SELECT ROWID FROM relations WHERE 1";
		var params = [];
		if (subject) {
			sql += " AND subject=?";
			params.push(subject);
		}
		if (predicate) {
			sql += " AND predicate=?";
			params.push(predicate);
		}
		if (object) {
			sql += " AND object=?";
			params.push(object);
		}
		var rows = yield Zotero.DB.columnQueryAsync(sql, params);
		if (!rows) {
			return [];
		}
		
		var toReturn = [];
		var loads = [];
		for (let i=0; i<rows.length; i++) {
			var relation = new this.ObjectClass;
			relation.id = rows[i];
			loads.push(relation.load());
			toReturn.push(relation);
		}
		yield Zotero.Promise.all(loads);
		return toReturn;
	});
	
	
	Zotero_Relations.prototype.getSubject = Zotero.Promise.coroutine(function* (subject, predicate, object) {
		var subjects = [];
		var relations = yield this.getByURIs(subject, predicate, object);
		for each(var relation in relations) {
			subjects.push(relation.subject);
		}
		return subjects;
	});
	
	
	Zotero_Relations.prototype.getObject = Zotero.Promise.coroutine(function* (subject, predicate, object) {
		var objects = [];
		var relations = yield this.getByURIs(subject, predicate, object);
		for each(var relation in relations) {
			objects.push(relation.object);
		}
		return objects;
	});
	
	
	Zotero_Relations.prototype.updateUser = Zotero.Promise.coroutine(function* (fromUserID, fromLibraryID, toUserID, toLibraryID) {
		if (!fromUserID) {
			throw ("Invalid source userID " + fromUserID + " in Zotero." + this._ZDO_Objects + ".updateUserID");
		}
		if (!fromLibraryID) {
			throw ("Invalid source libraryID " + fromLibraryID + " in Zotero." + this._ZDO_Objects + ".updateUserID");
		}
		if (!toUserID) {
			throw ("Invalid target userID " + toUserID + " in Zotero." + this._ZDO_Objects + ".updateUserID");
		}
		if (!toLibraryID) {
			throw ("Invalid target libraryID " + toLibraryID + " in Zotero." + this._ZDO_Objects + ".updateUserID");
		}
		
		yield Zotero.DB.executeTransaction(function* () {
			var sql = "UPDATE relations SET libraryID=? WHERE libraryID=?";
			Zotero.DB.query(sql, [toLibraryID, fromLibraryID]);
			
			sql = "UPDATE relations SET "
					+ "subject=REPLACE(subject, 'zotero.org/users/" + fromUserID + "', "
						+ "'zotero.org/users/" + toUserID + "'), "
					+ "object=REPLACE(object, 'zotero.org/users/" + fromUserID + "', "
						+ "'zotero.org/users/" + toUserID + "') "
						+ "WHERE predicate IN (?, ?)";
			Zotero.DB.query(sql, [this.linkedObjectPredicate, this.deletedItemPredicate]);
		}.bind(this));
	});
	
	
	Zotero_Relations.prototype.add = Zotero.Promise.coroutine(function* (libraryID, subject, predicate, object) {
		predicate = this._getPrefixAndValue(predicate).join(':');
		
		var relation = new this.ObjectClass;
		if (!libraryID) {
			libraryID = Zotero.Users.getCurrentLibraryID();
		}
		if (libraryID) {
			relation.libraryID = parseInt(libraryID);
		}
		else {
			relation.libraryID = "local/" + Zotero.Users.getLocalUserKey();
		}
		relation.subject = subject;
		relation.predicate = predicate;
		relation.object = object;
		yield relation.save();
	});
	
	
	/**
	 * Copy relations from one object to another within the same library
	 */
	Zotero_Relations.prototype.copyURIs = Zotero.Promise.coroutine(function* (libraryID, fromURI, toURI) {
		var rels = yield this.getByURIs(fromURI);
		for each(var rel in rels) {
			yield this.add(libraryID, toURI, rel.predicate, rel.object);
		}
		
		var rels = yield this.getByURIs(false, false, fromURI);
		for each(var rel in rels) {
			yield this.add(libraryID, rel.subject, rel.predicate, toURI);
		}
	});
	
	
	/**
	 * @param {String} prefix
	 * @param {String[]} ignorePredicates
	 */
	Zotero_Relations.prototype.eraseByURIPrefix = function (prefix, ignorePredicates) {
		return Zotero.DB.executeTransaction(function* () {
			prefix = prefix + '%';
			var sql = "SELECT ROWID FROM relations WHERE (subject LIKE ? OR object LIKE ?)";
			var params = [prefix, prefix];
			if (ignorePredicates) {
				for each(var ignorePredicate in ignorePredicates) {
					sql += " AND predicate != ?";
					params.push(ignorePredicate);
				}
			}
			var ids = yield Zotero.DB.columnQueryAsync(sql, params);
			
			for (let i=0; i<ids.length; i++) {
				let relation = yield this.get(ids[i]);
				yield relation.erase();
			}
		}.bind(this));
	}
	
	
	/**
	 * @return {Promise}
	 */
	Zotero_Relations.prototype.eraseByURI = function (uri, ignorePredicates) {
		return Zotero.DB.executeTransaction(function* () {
			var sql = "SELECT ROWID FROM relations WHERE (subject=? OR object=?)";
			var params = [uri, uri];
			if (ignorePredicates) {
				for each(var ignorePredicate in ignorePredicates) {
					sql += " AND predicate != ?";
					params.push(ignorePredicate);
				}
			}
			var ids = yield Zotero.DB.columnQueryAsync(sql, params);
			
			for (let i=0; i<ids.length; i++) {
				let relation = yield this.get(ids[i]);
				yield relation.erase();
			}
		}.bind(this));
	}
	
	
	Zotero_Relations.prototype.purge = Zotero.Promise.coroutine(function* () {
		var sql = "SELECT subject FROM relations WHERE predicate != ? "
				+ "UNION SELECT object FROM relations WHERE predicate != ?";
		var uris = yield Zotero.DB.columnQueryAsync(sql, [this.deletedItemPredicate, this.deletedItemPredicate]);
		if (uris) {
			var prefix = Zotero.URI.defaultPrefix;
			yield Zotero.DB.executeTransaction(function* () {
				for each(var uri in uris) {
					// Skip URIs that don't begin with the default prefix,
					// since they don't correspond to local items
					if (uri.indexOf(prefix) == -1) {
						continue;
					}
					if (uri.indexOf(/\/items\//) != -1 && !Zotero.URI.getURIItem(uri)) {
						this.eraseByURI(uri);
					}
					if (uri.indexOf(/\/collections\//) != -1 && !Zotero.URI.getURICollection(uri)) {
						this.eraseByURI(uri);
					}
				}
			}.bind(this));
		}
	});
	
	
	Zotero_Relations.prototype.xmlToRelation = function (relationNode) {
		var relation = new this.ObjectClass();
		var libraryID = relationNode.getAttribute('libraryID');
		if (libraryID) {
			relation.libraryID = parseInt(libraryID);
		}
		else {
			libraryID = Zotero.Users.getCurrentLibraryID();
			if (!libraryID) {
				libraryID = Zotero.Users.getLocalUserKey();
			}
			relation.libraryID = parseInt(libraryID);
		}
		
		var elems = Zotero.Utilities.xpath(relationNode, 'subject');
		relation.subject = elems.length ? elems[0].textContent : "";
		var elems = Zotero.Utilities.xpath(relationNode, 'predicate');
		relation.predicate = elems.length ? elems[0].textContent : "";
		var elems = Zotero.Utilities.xpath(relationNode, 'object');
		relation.object = elems.length ? elems[0].textContent : "";
		return relation;
	}
	
	Zotero_Relations.prototype._namespaces = {
		dc: 'http://purl.org/dc/elements/1.1/',
		owl: 'http://www.w3.org/2002/07/owl#'
	};
	
	Zotero_Relations.prototype._getPrefixAndValue = function(uri) {
		var [prefix, value] = uri.split(':');
		if (prefix && value) {
			if (!this._namespaces[prefix]) {
				throw ("Invalid prefix '" + prefix + "' in Zotero." + this._ZDO_Objects + "._getPrefixAndValue()");
			}
			return [prefix, value];
		}
		
		for (var prefix in namespaces) {
			if (uri.indexOf(namespaces[prefix]) == 0) {
				var value = uri.substr(namespaces[prefix].length - 1)
				return [prefix, value];
			}
		}
		throw ("Invalid namespace in URI '" + uri + "' in Zotero." + this._ZDO_Objects + "._getPrefixAndValue()");
	}
	
	return new Zotero_Relations();
}()