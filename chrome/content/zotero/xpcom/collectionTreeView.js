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

////////////////////////////////////////////////////////////////////////////////
///
///  CollectionTreeView
///    -- handles the link between an individual tree and the data layer
///    -- displays only collections, in a hierarchy (no items)
///
////////////////////////////////////////////////////////////////////////////////

/*
 *  Constructor for the CollectionTreeView object
 */
Zotero.CollectionTreeView = function()
{
	Zotero.LibraryTreeView.apply(this);
	
	this.itemToSelect = null;
	this.hideSources = [];
	
	this._highlightedRows = {};
	this._unregisterID = Zotero.Notifier.registerObserver(this, ['collection', 'search', 'share', 'group', 'trash', 'bucket'], 'collectionTreeView');
	this._containerState = {};
	this._duplicateLibraries = [];
	this._unfiledLibraries = [];
	this._trashNotEmpty = {};
}

Zotero.CollectionTreeView.prototype = Object.create(Zotero.LibraryTreeView.prototype);
Zotero.CollectionTreeView.prototype.type = 'collection';

Object.defineProperty(Zotero.CollectionTreeView.prototype, "selectedTreeRow", {
	get: function () {
		return this.getRow(this.selection.currentIndex);
	}
});



/*
 *  Called by the tree itself
 */
Zotero.CollectionTreeView.prototype.setTree = Zotero.Promise.coroutine(function* (treebox)
{
	try {
		if (this._treebox || !treebox) {
			return;
		}
		this._treebox = treebox;
		
		// Add a keypress listener for expand/collapse
		var tree = this._treebox.treeBody.parentNode;
		tree.addEventListener('keypress', function(event) {
			var key = String.fromCharCode(event.which);
			
			if (key == '+' && !(event.ctrlKey || event.altKey || event.metaKey)) {
				this.expandLibrary();
				return;
			}
			else if (key == '-' && !(event.shiftKey || event.ctrlKey ||
					event.altKey || event.metaKey)) {
				this.collapseLibrary();
				return;
			}
		}.bind(this), false);
		
		yield this.refresh();
		if (!this._treebox.columns) {
			return;
		}
		this.selection.currentColumn = this._treebox.columns.getFirstColumn();
		
		var row = yield this.getLastViewedRow();
		this.selection.select(row);
		this._treebox.ensureRowIsVisible(row);
		
		yield this._runListeners('load');
		this._initialized = true;
	}
	catch (e) {
		Zotero.debug(e, 1);
		Components.utils.reportError(e);
		if (this.onError) {
			this.onError(e);
		}
		throw e;
	}
});


/*
 *  Reload the rows from the data access methods
 *  (doesn't call the tree.invalidate methods, etc.)
 */
Zotero.CollectionTreeView.prototype.refresh = Zotero.Promise.coroutine(function* ()
{
	Zotero.debug("Refreshing collections pane");
	
	// Record open states before refreshing
	if (this._rows) {
		for (var i=0, len=this._rows.length; i<len; i++) {
			var treeRow = this._rows[i][0]
			if (treeRow.ref && treeRow.ref.id == 'commons-header') {
				var commonsExpand = this.isContainerOpen(i);
			}
		}
	}
	
	try {
		this._containerState = JSON.parse(Zotero.Prefs.get("sourceList.persist"));
	}
	catch (e) {
		this._containerState = {};
	}
	
	if (this.hideSources.indexOf('duplicates') == -1) {
		try {
			this._duplicateLibraries = Zotero.Prefs.get('duplicateLibraries').split(',').map(function (val) parseInt(val));
		}
		catch (e) {
			// Add to personal library by default
			Zotero.Prefs.set('duplicateLibraries', ''+Zotero.Libraries.userLibraryID);
			this._duplicateLibraries = [Zotero.Libraries.userLibraryID];
		}
	}
	
	try {
		this._unfiledLibraries = Zotero.Prefs.get('unfiledLibraries').split(',').map(function (val) parseInt(val));
	}
	catch (e) {
		// Add to personal library by default
		Zotero.Prefs.set('unfiledLibraries', ''+Zotero.Libraries.userLibraryID);
		this._unfiledLibraries = [Zotero.Libraries.userLibraryID];
	}
	
	var oldCount = this.rowCount || 0;
	var newRows = [];
	
	var self = this;
	var library = {
		libraryID: Zotero.Libraries.userLibraryID
	};
	
	if (yield Zotero.Feeds.haveFeeds()) {
		let feedLibrary = {
			libraryID: Zotero.Libraries.feedLibraryID
		};
		this._addRow(newRows, new Zotero.CollectionTreeRow('feedLibrary', feedLibrary));
		yield this._expandRow(newRows, 0);
		this._addRow(newRows, new Zotero.CollectionTreeRow('separator', false));
	}
	
	// rows, treeRow, level, beforeRow
	this._addRow(newRows, new Zotero.CollectionTreeRow('library', library));
	yield this._expandRow(newRows, newRows.length-1);
	
	var groups = yield Zotero.Groups.getAll();
	if (groups.length) {
		this._addRow(newRows, new Zotero.CollectionTreeRow('separator', false));
		var header = {
			id: "group-libraries-header",
			label: Zotero.getString('pane.collections.groupLibraries'),
			libraryID: -1,
			expand: Zotero.Promise.coroutine(function* (rows, beforeRow, groups) {
				if (!groups) {
					groups = yield Zotero.Groups.getAll();
				}
				var newRows = 0;
				for (var i = 0, len = groups.length; i < len; i++) {
					var row = self._addRow(
						rows,
						new Zotero.CollectionTreeRow('group', groups[i]),
						1,
						beforeRow ? beforeRow + i + newRows : null
					);
					newRows += yield self._expandRow(rows, row);
				}
				return newRows;
			})
		}
		var row = this._addRow(newRows, new Zotero.CollectionTreeRow('header', header));
		if (this._containerState.HG) {
			newRows[row][1] = true;
			yield header.expand(newRows, null, groups);
		}
	}
	
	this.selection.clearSelection();
	this._rows = newRows;
	this.rowCount = this._rows.length;
	this._refreshCollectionRowMap();
	
	var diff = this.rowCount - oldCount;
	if (diff != 0) {
		this._treebox.rowCountChanged(0, diff);
	}
});


/*
 *  Redisplay everything
 */
Zotero.CollectionTreeView.prototype.reload = function()
{
	return this.refresh()
	.then(function () {
		this._treebox.invalidate();
	}.bind(this));
}

/*
 *  Called by Zotero.Notifier on any changes to collections in the data layer
 */
Zotero.CollectionTreeView.prototype.notify = Zotero.Promise.coroutine(function* (action, type, ids)
{
	if ((!ids || ids.length == 0) && action != 'refresh' && action != 'redraw') {
		return;
	}
	
	if (!this._collectionRowMap) {
		Zotero.debug("Collection row map didn't exist in collectionTreeView.notify()");
		return;
	}
	
	if (action == 'refresh' && type == 'trash') {
		// libraryID is passed as parameter to 'refresh'
		let deleted = yield Zotero.Items.getDeleted(ids[0], true);
		this._trashNotEmpty[ids[0]] = !!deleted.length;
		return;
	}
	
	if (action == 'redraw') {
		this._treebox.invalidate();
		return;
	}
	
	this.selection.selectEventsSuppressed = true;
	var savedSelection = this.saveSelection();
	
	if (action == 'delete') {
		var selectedIndex = this.selection.count ? this.selection.currentIndex : 0;
		
		//Since a delete involves shifting of rows, we have to do it in order
		
		//sort the ids by row
		var rows = [];
		for (var i in ids)
		{
			switch (type)
			{
				case 'collection':
					let rowIndex = this._rowMap['C' + ids[i]];
					if (typeof rowIndex != 'undefined') {
						if (this.getRow(rowIndex).isFeed()) {
							// Reload to make sure feed library gets hidden when empty
							yield this.reload();
							this.rememberSelection(savedSelection);
							break;
						}
						rows.push(rowIndex);
					}
					break;
				
				case 'search':
					if (typeof this._rowMap['S' + ids[i]] != 'undefined') {
						rows.push(this._rowMap['S' + ids[i]]);
					}
					break;
				
				case 'group':
					//if (this._rowMap['G' + ids[i]] != null) {
					//	rows.push(this._rowMap['G' + ids[i]]);
					//}
					
					// For now, just reload if a group is removed, since otherwise
					// we'd have to remove collections too
					yield this.reload();
					this.rememberSelection(savedSelection);
					break;
			}
		}
		
		if(rows.length > 0)
		{
			rows.sort(function(a,b) { return a-b });
			
			for(var i=0, len=rows.length; i<len; i++)
			{
				var row = rows[i];
				this._removeRow(row);
				this._treebox.rowCountChanged(row, -1);
			}
			
			this._refreshCollectionRowMap();
		}
		
		if (!this.selection.count) {
			// If last row was selected, stay on the last row
			if (selectedIndex >= this.rowCount) {
				selectedIndex = this.rowCount - 1;
			};
			this.selection.select(selectedIndex)
		}
		
		// Make sure the selection doesn't land on a separator (e.g. deleting last feed)
		let index = this.selection.currentIndex;
		while (index >= 0 && !this.isSelectable(index)) {
			// move up, since we got shifted down
			index--;
		}
		
		if (index >= 0) {
			this.selection.select(index);
		} else {
			this.selection.clearSelection();
		}
		
	}
	else if(action == 'move')
	{
		yield this.reload();
		
		// Open the new parent collection if closed
		for (var i=0; i<ids.length; i++) {
			var collection = yield Zotero.Collections.getAsync(ids[i]);
			var parentID = collection.parentID;
			if (parentID && this._collectionRowMap[parentID] &&
					!this.isContainerOpen(this._collectionRowMap[parentID])) {
				yield this.toggleOpenState(this._collectionRowMap[parentID]);
			}
		}
		
		this.rememberSelection(savedSelection);
	}
	else if (action == 'modify' || action == 'refresh') {
		if (type != 'bucket') {
			yield this.reload();
		}
		this.rememberSelection(savedSelection);
	}
	else if(action == 'add')
	{
		// Multiple adds not currently supported
		ids = ids[0];
		
		switch (type)
		{
			case 'feed':
			case 'collection':
				var collection = type == 'collection'
					? yield Zotero.Collections.getAsync(ids)
					: yield Zotero.Feeds.getAsync(ids);
				
				// Open container if creating subcollection
				var parentID = collection.parentID;
				if (parentID) {
					if (!this.isContainerOpen(this._collectionRowMap[parentID])){
						this.toggleOpenState(this._collectionRowMap[parentID]);
					}
				}
				
				yield this.reload();
				if (Zotero.suppressUIUpdates) {
					this.rememberSelection(savedSelection);
					break;
				}
				let row = this._collectionRowMap[collection.id];
				this._treebox.ensureRowIsVisible(row);
				this.selection.select(row);
				break;
				
			case 'search':
				yield this.reload();
				if (Zotero.suppressUIUpdates) {
					this.rememberSelection(savedSelection);
					break;
				}
				this.selection.select(this._rowMap['S' + ids]);
				break;
			
			case 'group':
				yield this.reload();
				// Groups can only be created during sync
				this.rememberSelection(savedSelection);
				break;

			case 'bucket':
				yield this.reload();
				this.rememberSelection(savedSelection);
				break;
		}
	}
	
	this.selection.selectEventsSuppressed = false;
});


/*
 * Set the rows that should be highlighted -- actual highlighting is done
 * by getRowProperties based on the array set here
 */
Zotero.CollectionTreeView.prototype.setHighlightedRows = Zotero.Promise.coroutine(function* (ids) {
	this._highlightedRows = {};
	this._treebox.invalidate();
	
	for each(var id in ids) {
		yield this.expandToCollection(id);
		this._highlightedRows[this._collectionRowMap[id]] = true;
		this._treebox.invalidateRow(this._collectionRowMap[id]);
	}
});


/*
 *  Unregisters view from Zotero.Notifier (called on window close)
 */
Zotero.CollectionTreeView.prototype.unregister = function()
{
	Zotero.Notifier.unregisterObserver(this._unregisterID);
}


////////////////////////////////////////////////////////////////////////////////
///
///  nsITreeView functions
///  http://www.xulplanet.com/references/xpcomref/ifaces/nsITreeView.html
///
////////////////////////////////////////////////////////////////////////////////

Zotero.CollectionTreeView.prototype.getCellText = function(row, column)
{
	var obj = this.getRow(row);
	
	if (column.id == 'zotero-collections-name-column') {
		return obj.getName();
	}
	else
		return "";
}

Zotero.CollectionTreeView.prototype.getImageSrc = function(row, col)
{
	var treeRow = this.getRow(row);
	var collectionType = treeRow.type;
	
	if (collectionType == 'group') {
		collectionType = 'library';
	}
	
	// Show sync icons only in library rows
	if (collectionType != 'library' && col.index != 0) {
		return '';
	}
	
	switch (collectionType) {
		case 'library':
		case 'feedLibrary':
		case 'feed':
			break;
		
		case 'trash':
			if (this._trashNotEmpty[treeRow.ref.libraryID]) {
				collectionType += '-full';
			}
			break;
		
		case 'header':
			if (treeRow.ref.id == 'group-libraries-header') {
				collectionType = 'groups';
			}
			else if (treeRow.ref.id == 'commons-header') {
				collectionType = 'commons';
			}
			break;
		
		
			collectionType = 'library';
			break;
		
		case 'collection':
		case 'search':
			return "chrome://zotero-platform/content/treesource-" + collectionType + ".png";
	}
	
	return "chrome://zotero/skin/treesource-" + collectionType + ".png";
}

Zotero.CollectionTreeView.prototype.isContainer = function(row)
{
	var treeRow = this.getRow(row);
	return treeRow.isLibrary(true) || treeRow.isCollection() || treeRow.isHeader() || treeRow.isBucket();
}

Zotero.CollectionTreeView.prototype.isContainerOpen = function(row)
{
	return this._rows[row][1];
}

/*
 * Returns true if the collection has no child collections
 */
Zotero.CollectionTreeView.prototype.isContainerEmpty = function(row)
{
	var treeRow = this.getRow(row);
	if (treeRow.isLibrary()) {
		return false;
	}
	if (treeRow.isHeader()) {
		return false;
	}
	if (treeRow.isBucket()) {
		return true;
	}
	if (treeRow.isGroup()) {
		var libraryID = treeRow.ref.libraryID;
		
		return !treeRow.ref.hasCollections()
				&& !treeRow.ref.hasSearches()
				&& this._duplicateLibraries.indexOf(libraryID) == -1
				&& this._unfiledLibraries.indexOf(libraryID) == -1
				&& this.hideSources.indexOf('trash') != -1;
	}
	if (treeRow.isFeedLibrary()) {
		return false; // If it's shown, it has something
	}
	if (treeRow.isCollection()) {
		return !treeRow.ref.hasChildCollections();
	}
	return true;
}

Zotero.CollectionTreeView.prototype.getLevel = function(row)
{
	return this._rows[row][2];
}

Zotero.CollectionTreeView.prototype.getParentIndex = function(row)
{
	var thisLevel = this.getLevel(row);
	if(thisLevel == 0) return -1;
	for(var i = row - 1; i >= 0; i--)
		if(this.getLevel(i) < thisLevel)
			return i;
	return -1;
}

Zotero.CollectionTreeView.prototype.hasNextSibling = function(row, afterIndex)
{
	var thisLevel = this.getLevel(row);
	for(var i = afterIndex + 1; i < this.rowCount; i++)
	{	
		var nextLevel = this.getLevel(i);
		if(nextLevel == thisLevel) return true;
		else if(nextLevel < thisLevel) return false;
	}
}

/*
 *  Opens/closes the specified row
 */
Zotero.CollectionTreeView.prototype.toggleOpenState = Zotero.Promise.coroutine(function* (row)
{
	var count = 0;
	var thisLevel = this.getLevel(row);
	
	//this._treebox.beginUpdateBatch();
	if (this.isContainerOpen(row)) {
		while((row + 1 < this._rows.length) && (this.getLevel(row + 1) > thisLevel))
		{
			this._removeRow(row+1);
			count--;
		}
		// Remove from the end of the row's children
		this._treebox.rowCountChanged(row + 1 + Math.abs(count), count);
	}
	else {
		var treeRow = this.getRow(row);
		if (treeRow.type == 'header') {
			count = yield treeRow.ref.expand(this._rows, row + 1);
		}
		else if (treeRow.isLibrary(true) || treeRow.isCollection()) {
			count = yield this._expandRow(this._rows, row, true);
		}
		this.rowCount += count;
		this._treebox.rowCountChanged(row + 1, count);
	}
	
	// Toggle container open value
	this._rows[row][1] = !this._rows[row][1];
	this._treebox.invalidateRow(row);
	//this._treebox.endUpdateBatch();
	this._refreshCollectionRowMap();
	yield this._rememberOpenStates();
});


Zotero.CollectionTreeView.prototype.isSelectable = function (row, col) {
	var treeRow = this.getRow(row);
	switch (treeRow.type) {
		case 'separator':
			return false;
	}
	return true;
}


/**
 * Tree method for whether to allow inline editing (not to be confused with this.editable)
 */
Zotero.CollectionTreeView.prototype.isEditable = function (row, col) {
	return this.selectedTreeRow.isCollection() && this.editable;
}


Zotero.CollectionTreeView.prototype.setCellText = function (row, col, val) {
	val = val.trim();
	if (val === "") {
		return;
	}
	var treeRow = this.getRow(row);
	treeRow.ref.name = val;
	treeRow.ref.save();
}



/**
 * Returns TRUE if the underlying view is editable
 */
Zotero.CollectionTreeView.prototype.__defineGetter__('editable', function () {
	return this.getRow(this.selection.currentIndex).editable;
});


Zotero.CollectionTreeView.prototype.expandLibrary = Zotero.Promise.coroutine(function* () {
	var selectedLibraryID = this.getSelectedLibraryID();
	if (selectedLibraryID === false) {
		return;
	}
	
	//this._treebox.beginUpdateBatch();
	
	var selection = this.saveSelection();
	
	var found = false;
	for (var i=0; i<this.rowCount; i++) {
		if (this.getRow(i).ref.libraryID != selectedLibraryID) {
			// Once we've moved beyond the original library, stop looking
			if (found) {
				break;
			}
			continue;
		}
		
		found = true;
		
		if (this.isContainer(i) && !this.isContainerOpen(i)) {
			yield this.toggleOpenState(i);
		}
	}
	
	//this._treebox.endUpdateBatch();
	
	this.rememberSelection(selection);
});


Zotero.CollectionTreeView.prototype.collapseLibrary = Zotero.Promise.coroutine(function* () {
	var selectedLibraryID = this.getSelectedLibraryID();
	if (selectedLibraryID === false) {
		return;
	}
	
	//this._treebox.beginUpdateBatch();
	
	var found = false;
	for (var i=this.rowCount-1; i>=0; i--) {
		if (this.getRow(i).ref.libraryID !== selectedLibraryID) {
			// Once we've moved beyond the original library, stop looking
			if (found) {
				break;
			}
			continue;
		}
		
		found = true;
		
		if (this.isContainer(i) && this.isContainerOpen(i)) {
			yield this.toggleOpenState(i);
		}
	}
	
	//this._treebox.endUpdateBatch();
	
	// Select the collapsed library
	yield this.selectLibrary(selectedLibraryID);
});


Zotero.CollectionTreeView.prototype.expandToCollection = Zotero.Promise.coroutine(function* (collectionID) {
	var col = yield Zotero.Collections.getAsync(collectionID);
	if (!col) {
		Zotero.debug("Cannot expand to nonexistent collection " + collectionID, 2);
		return false;
	}
	var row = this._collectionRowMap[collectionID];
	if (row) {
		return true;
	}
	var path = [];
	var parent;
	while (parent = col.parentID) {
		path.unshift(parent);
		col = yield Zotero.Collections.getAsync(parentID);
	}
	for each(var id in path) {
		row = this._collectionRowMap[id];
		if (!this.isContainerOpen(row)) {
			yield this.toggleOpenState(row);
		}
	}
	return true;
});



////////////////////////////////////////////////////////////////////////////////
///
///  Additional functions for managing data in the tree
///
////////////////////////////////////////////////////////////////////////////////
/**
 * @param	{Integer}		libraryID		Library to select
 */
Zotero.CollectionTreeView.prototype.selectLibrary = Zotero.Promise.coroutine(function* (libraryID) {
	if (Zotero.suppressUIUpdates) {
		Zotero.debug("UI updates suppressed -- not changing library selection");
		return false;
	}
	
	// Select local library
	if (!libraryID) libraryID = Zotero.Libraries.userLibraryID;
	
	// Check if library is already selected
	if (this.selection.currentIndex != -1) {
		var treeRow = this.getRow(this.selection.currentIndex);
		if (treeRow.isLibrary(true) && treeRow.ref.libraryID == libraryID) {
			this._treebox.ensureRowIsVisible(this.selection.currentIndex);
			return true;
		}
	}
	
	// Find library
	for (var i = 0; i < this.rowCount; i++) {
		var treeRow = this.getRow(i);
		
		// If group header is closed, open it
		if (treeRow.isHeader() && treeRow.ref.id == 'group-libraries-header'
				&& !this.isContainerOpen(i)) {
			yield this.toggleOpenState(i);
			continue;
		}
		
		if (treeRow.ref && treeRow.ref.libraryID == libraryID) {
			this._treebox.ensureRowIsVisible(i);
			this.selection.select(i);
			return true;
		}
	}
	
	return false;
});


/**
 * Select the last-viewed source
 */
Zotero.CollectionTreeView.prototype.getLastViewedRow = Zotero.Promise.coroutine(function* () {
	var lastViewedFolder = Zotero.Prefs.get('lastViewedFolder');
	var matches = lastViewedFolder.match(/^([A-Z])([G0-9]+)?$/);
	var select = 0;
	if (matches) {
		if (matches[1] == 'C') {
			if (this._collectionRowMap[matches[2]]) {
				select = this._collectionRowMap[matches[2]];
			}
			// Search recursively
			else {
				var path = [];
				var failsafe = 10; // Only go up ten levels
				var lastCol = matches[2];
				do {
					failsafe--;
					var col = yield Zotero.Collections.getAsync(lastCol);
					if (!col) {
						var msg = "Last-viewed collection not found";
						Zotero.debug(msg);
						path = [];
						break;
					}
					var par = col.parentID;
					if (!par) {
						var msg = "Parent collection not found in "
							+ "Zotero.CollectionTreeView.setTree()";
						Zotero.debug(msg, 1);
						Components.utils.reportError(msg);
						path = [];
						break;
					}
					lastCol = par;
					path.push(lastCol);
				}
				while (!this._collectionRowMap[lastCol] && failsafe > 0)
				if (path.length) {
					for (var i=path.length-1; i>=0; i--) {
						var id = path[i];
						var row = this._collectionRowMap[id];
						if (!row) {
							var msg = "Collection not found in tree in "
								+ "Zotero.CollectionTreeView.setTree()";
							Zotero.debug(msg, 1);
							Components.utils.reportError(msg);
							break;
						}
						if (!this.isContainerOpen(row)) {
							yield this.toggleOpenState(row);
							if (this._collectionRowMap[matches[2]]) {
								select = this._collectionRowMap[matches[2]];
								break;
							}
						}
					}
				}
			}
		}
		else {
			var id = matches[1] + (matches[2] ? matches[2] : "");
			if (this._rowMap[id]) {
				select = this._rowMap[id];
			}
		}
	}
	
	return select;
});


/*
 *  Delete the selection
 */
Zotero.CollectionTreeView.prototype.deleteSelection = Zotero.Promise.coroutine(function* (deleteItems)
{
	if(this.selection.count == 0)
		return;

	//collapse open collections
	for (let i=0; i<this.rowCount; i++) {
		if (this.selection.isSelected(i) && this.isContainer(i) && this.isContainerOpen(i)) {
			yield this.toggleOpenState(i);
		}
	}
	this._refreshCollectionRowMap();
	
	//create an array of collections
	var rows = new Array();
	var start = new Object();
	var end = new Object();
	for (var i=0, len=this.selection.getRangeCount(); i<len; i++)
	{
		this.selection.getRangeAt(i,start,end);
		for (var j=start.value; j<=end.value; j++)
			if(!this.getRow(j).isLibrary())
				rows.push(j);
	}
	
	//iterate and erase...
	//this._treebox.beginUpdateBatch();
	for (var i=0; i<rows.length; i++)
	{
		//erase collection from DB:
		var treeRow = this.getRow(rows[i]-i);
		if (treeRow.isCollection(true)) {
			yield treeRow.ref.erase(deleteItems);
		}
		else if (treeRow.isSearch()) {
			yield Zotero.Searches.erase(treeRow.ref.id);
		}
	}
	//this._treebox.endUpdateBatch();
	
	if (end.value < this.rowCount) {
		var row = this.getRow(end.value);
		if (row.isSeparator()) {
			return;
		}
		this.selection.select(end.value);
	}
	else {
		this.selection.select(this.rowCount-1);
	}
});


/**
 * Expand row based on last state, or manually from toggleOpenState()
 */
Zotero.CollectionTreeView.prototype._expandRow = Zotero.Promise.coroutine(function* (rows, row, forceOpen) {
	var treeRow = rows[row][0];
	var level = rows[row][2];
	var isLibrary = treeRow.isLibrary(true);
	var isGroup = treeRow.isGroup();
	var isFeedLibrary = treeRow.isFeedLibrary();
	var isCollection = treeRow.isCollection(true);
	var libraryID = treeRow.ref.libraryID;
	
	if (isGroup) {
		var group = yield Zotero.Groups.getByLibraryID(libraryID);
		var collections = yield group.getCollections();
	}
	else if (isFeedLibrary) {
		var collections = yield Zotero.Feeds.getFeedsInLibrary();
	}
	else {
		var collections = yield Zotero.Collections.getByParent(libraryID, treeRow.ref.id);
	}
	
	if (isLibrary && !isFeedLibrary) {
		var savedSearches = yield Zotero.Searches.getAll(libraryID);
		var showDuplicates = (this.hideSources.indexOf('duplicates') == -1
				&& this._duplicateLibraries.indexOf(libraryID) != -1);
		var showUnfiled = this._unfiledLibraries.indexOf(libraryID) != -1;
		var showTrash = this.hideSources.indexOf('trash') == -1;
	}
	else {
		var savedSearches = [];
		var showDuplicates = false;
		var showUnfiled = false;
		var showTrash = false;
	}
	
	// If not a manual open and either the library is set to be hidden
	// or this is a collection that isn't explicitly opened,
	// set the initial state to closed
	if (!forceOpen &&
			(this._containerState[treeRow.id] === false
				|| (isCollection && !this._containerState[treeRow.id]))) {
		rows[row][1] = false;
		return 0;
	}
	
	var startOpen = !!(collections.length || savedSearches.length || showDuplicates || showUnfiled || showTrash);
	
	// If this isn't a manual open, set the initial state depending on whether
	// there are child nodes
	if (!forceOpen) {
		rows[row][1] = startOpen;
	}
	
	if (!startOpen) {
		return 0;
	}
	
	var newRows = 0;
	
	// Add collections
	for (var i = 0, len = collections.length; i < len; i++) {
		// In personal library root, skip group collections
		if (!isGroup && !isCollection && !isFeedLibrary && collections[i].libraryID) {
			continue;
		}
		
		var type = isFeedLibrary ? 'feed' : 'collection';
		var newRow = this._addRow(
			rows,
			new Zotero.CollectionTreeRow(type, collections[i]),
			level + 1,
			row + 1 + newRows
		);
		
		// Recursively expand child collections that should be open
		newRows += yield this._expandRow(rows, newRow);
		
		newRows++;
	}
	
	if (isCollection || isFeedLibrary) {
		return newRows;
	}
	
	// Add searches
	for (var i = 0, len = savedSearches.length; i < len; i++) {
		this._addRow(rows, new Zotero.CollectionTreeRow('search', savedSearches[i]), level + 1, row + 1 + newRows);
		newRows++;
	}
	
	// Duplicate items
	if (showDuplicates) {
		let d = new Zotero.Duplicates(libraryID);
		this._addRow(rows, new Zotero.CollectionTreeRow('duplicates', d), level + 1, row + 1 + newRows);
		newRows++;
	}
	
	// Unfiled items
	if (showUnfiled) {
		let s = new Zotero.Search;
		s.libraryID = libraryID;
		s.name = Zotero.getString('pane.collections.unfiled');
		yield s.addCondition('libraryID', 'is', libraryID);
		yield s.addCondition('unfiled', 'true');
		this._addRow(rows, new Zotero.CollectionTreeRow('unfiled', s), level + 1, row + 1 + newRows);
		newRows++;
	}
	
	if (showTrash) {
		let deletedItems = yield Zotero.Items.getDeleted(libraryID);
		if (deletedItems.length || Zotero.Prefs.get("showTrashWhenEmpty")) {
			var ref = {
				libraryID: libraryID
			};
			this._addRow(rows, new Zotero.CollectionTreeRow('trash', ref), level + 1, row + 1 + newRows);
			newRows++;
		}
		this._trashNotEmpty[libraryID] = !!deletedItems.length;
	}
	
	return newRows;
});


/*
 *  Called by various view functions to show a row
 */
Zotero.CollectionTreeView.prototype._addRow = function (rows, treeRow, level, beforeRow) {
	if (!level) {
		level = 0;
	}
	
	if (!beforeRow) {
		beforeRow = rows.length;
	}
	
	rows.splice(beforeRow, 0, [treeRow, false, level]);
	
	return beforeRow;
}


/*
 *  Called by view to hide specified row
 */
Zotero.CollectionTreeView.prototype._removeRow = function(row)
{
	this._rows.splice(row,1);
	this.rowCount--;
	if (this.selection.isSelected(row)) {
		this.selection.toggleSelect(row);
	}
}


/**
 * Returns Zotero.CollectionTreeRow at row
 */
Zotero.CollectionTreeView.prototype.getRow = function (row) {
	return this._rows[row][0];
}


/**
 * Returns libraryID or FALSE if not a library
 */
Zotero.CollectionTreeView.prototype.getSelectedLibraryID = function() {
	var treeRow = this.getRow(this.selection.currentIndex);
	return treeRow && treeRow.ref && treeRow.ref.libraryID !== undefined
			&& treeRow.ref.libraryID;
}


Zotero.CollectionTreeView.prototype.getSelectedCollection = function(asID) {
	if (this.selection
			&& this.selection.count > 0
			&& this.selection.currentIndex != -1) {
		var collection = this.getRow(this.selection.currentIndex);
		if (collection && collection.isCollection(true)) {
			return asID ? collection.ref.id : collection.ref;
		}
	}
	return false;
}


/*
 *  Saves the ids of the currently selected item for later
 */
Zotero.CollectionTreeView.prototype.saveSelection = function()
{
	for (var i=0, len=this.rowCount; i<len; i++) {
		if (this.selection.isSelected(i)) {
			var treeRow = this.getRow(i);
			var id = treeRow.id;
			if (id) {
				return id;
			}
			else {
				break;
			}
		}
	}
	return false;
}

/*
 *  Sets the selection based on saved selection ids (see above)
 */
Zotero.CollectionTreeView.prototype.rememberSelection = Zotero.Promise.coroutine(function* (selection)
{
	if (selection && this._rowMap[selection] != 'undefined') {
		this.selection.select(this._rowMap[selection]);
	}
});


/**
 * Creates mapping of item group ids to tree rows
 */
Zotero.CollectionTreeView.prototype._refreshCollectionRowMap = function()
{	
	this._collectionRowMap = [];
	this._rowMap = [];
	for(var i = 0, len = this.rowCount; i < len; i++) {
		var treeRow = this.getRow(i);
		
		// Collections get special treatment for now
		if (treeRow.isCollection(true)) {
			this._collectionRowMap[treeRow.ref.id] = i;
		}
		
		this._rowMap[treeRow.id] = i;
	}
}


Zotero.CollectionTreeView.prototype._rememberOpenStates = Zotero.Promise.coroutine(function* () {
	var state = this._containerState;
	
	// Every so often, remove obsolete rows
	if (Math.random() < 1/20) {
		Zotero.debug("Purging sourceList.persist");
		for (var id in state) {
			var m = id.match(/^C([0-9]+)$/);
			if (m) {
				if (!(yield Zotero.Collections.getAsync(m[1]))) {
					delete state[id];
				}
				continue;
			}
			
			var m = id.match(/^G([0-9]+)$/);
			if (m) {
				if (!Zotero.Groups.get(m[1])) {
					delete state[id];
				}
				continue;
			}
		}
	}
	
	for (var i = 0, len = this.rowCount; i < len; i++) {
		if (!this.isContainer(i)) {
			continue;
		}
		
		var treeRow = this.getRow(i);
		if (!treeRow.id) {
			continue;
		}
		
		var open = this.isContainerOpen(i);
		
		// Collections default to closed
		if (!open && treeRow.isCollection(true)) {
			delete state[treeRow.id];
			continue;
		}
		
		state[treeRow.id] = open;
	}
	
	this._containerState = state;
	Zotero.Prefs.set("sourceList.persist", JSON.stringify(state));
});


////////////////////////////////////////////////////////////////////////////////
///
///  Command Controller:
///		for Select All, etc.
///
////////////////////////////////////////////////////////////////////////////////

Zotero.CollectionTreeCommandController = function(tree)
{
	this.tree = tree;
}

Zotero.CollectionTreeCommandController.prototype.supportsCommand = function(cmd)
{
}

Zotero.CollectionTreeCommandController.prototype.isCommandEnabled = function(cmd)
{
}

Zotero.CollectionTreeCommandController.prototype.doCommand = function(cmd)
{
}

Zotero.CollectionTreeCommandController.prototype.onEvent = function(evt)
{
}

////////////////////////////////////////////////////////////////////////////////
///
///  Drag-and-drop functions:
///		canDrop() and drop() are for nsITreeView
///		onDragStart() and onDrop() are for HTML 5 Drag and Drop
///
////////////////////////////////////////////////////////////////////////////////


/*
 * Start a drag using HTML 5 Drag and Drop
 */
Zotero.CollectionTreeView.prototype.onDragStart = function(event) {
	// See note in LibraryTreeView::_setDropEffect()
	if (Zotero.isWin) {
		event.dataTransfer.effectAllowed = 'move';
	}
	
	var treeRow = this.selectedTreeRow;
	if (!treeRow.isCollection()) {
		return;
	}
	event.dataTransfer.setData("zotero/collection", treeRow.ref.id);
}


/**
 * Called by treechildren.onDragOver() before setting the dropEffect,
 * which is checked in libraryTreeView.canDrop()
 */
Zotero.CollectionTreeView.prototype.canDropCheck = function (row, orient, dataTransfer) {
	//Zotero.debug("Row is " + row + "; orient is " + orient);
	
	var dragData = Zotero.DragDrop.getDataFromDataTransfer(dataTransfer);
	if (!dragData) {
		Zotero.debug("No drag data");
		return false;
	}
	var dataType = dragData.dataType;
	var data = dragData.data;
	
	if (orient == 0) {
		var treeRow = this.getRow(row); //the collection we are dragging over
		
		if (dataType == 'zotero/item' && treeRow.isBucket()) {
			return true;
		}
		
		if (!treeRow.editable) {
			Zotero.debug("Drop target not editable");
			return false;
		}
		
		if (dataType == 'zotero/item') {
			var ids = data;
			var items = Zotero.Items.get(ids);
			var skip = true;
			Zotero.debug(ids);
			for each(var item in items) {
				// Can only drag top-level items
				if (!item.isTopLevelItem()) {
					Zotero.debug("Can't drag child item");
					return false;
				}
				
				if (treeRow.isWithinGroup() && item.isAttachment()) {
					// Linked files can't be added to groups
					if (item.attachmentLinkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE) {
						Zotero.debug("Linked files cannot be added to groups");
						return false;
					}
					if (!treeRow.filesEditable) {
						Zotero.debug("Drop target does not allow files to be edited");
						return false;
					}
					skip = false;
					continue;
				}
				
				// Cross-library drag
				if (treeRow.ref.libraryID != item.libraryID) {
					// Only allow cross-library drag to root library and collections
					if (!(treeRow.isLibrary(true) || treeRow.isCollection())) {
						Zotero.debug("Cross-library drag to non-collection not allowed");
						return false;
					}
					skip = false;
					continue;
				}
				
				// Intra-library drag
				
				// Don't allow drag onto root of same library
				if (treeRow.isLibrary(true)) {
					Zotero.debug("Can't drag into same library root");
					return false;
				}
				
				// Allow drags to collections. Item collection membership is an asynchronous
				// check, so we do that on drop()
				if (treeRow.isCollection()) {
					skip = false;
				}
			}
			if (skip) {
				Zotero.debug("Drag skipped");
				return false;
			}
			return true;
		}
		else if (dataType == 'text/x-moz-url' || dataType == 'application/x-moz-file') {
			if (treeRow.isSearch()) {
				return false;
			}
			if (dataType == 'application/x-moz-file') {
				// Don't allow folder drag
				if (data[0].isDirectory()) {
					return false;
				}
				// Don't allow drop if no permissions
				if (!treeRow.filesEditable) {
					return false;
				}
			}
			
			return true;
		}
		else if (dataType == 'zotero/collection') {
			let draggedCollectionID = data[0];
			let draggedCollection = Zotero.Collections.get(draggedCollectionID);
			
			if (treeRow.ref.libraryID == draggedCollection.libraryID) {
				// Collections cannot be dropped on themselves
				if (draggedCollectionID == treeRow.ref.id) {
					return false;
				}
				
				// Nor in their children
				// TODO: figure out synchronously from tree
				/*if (yield col.hasDescendent('collection', treeRow.ref.id)) {
					return false;
				}*/
			}
			// Dragging a collection to a different library
			else {
				// Allow cross-library drag only to root library and collections
				if (!treeRow.isLibrary(true) && !treeRow.isCollection()) {
					return false;
				}
			}
			
			return true;
		}
	}
	return false;
};


/**
 * Perform additional asynchronous drop checks
 *
 * Called by treechildren.drop()
 */
Zotero.CollectionTreeView.prototype.canDropCheckAsync = Zotero.Promise.coroutine(function* (row, orient, dataTransfer) {
	//Zotero.debug("Row is " + row + "; orient is " + orient);
	
	var dragData = Zotero.DragDrop.getDataFromDataTransfer(dataTransfer);
	if (!dragData) {
		Zotero.debug("No drag data");
		return false;
	}
	var dataType = dragData.dataType;
	var data = dragData.data;
	
	if (orient == 0) {
		var treeRow = this.getRow(row); //the collection we are dragging over
		
		if (dataType == 'zotero/item' && treeRow.isBucket()) {
			return true;
		}
		
		if (dataType == 'zotero/item') {
			if (treeRow.isCollection()) {
				yield treeRow.ref.loadChildItems();
			}
			
			var ids = data;
			var items = Zotero.Items.get(ids);
			var skip = true;
			for (let i=0; i<items.length; i++) {
				let item = items[i];
				
				// Cross-library drag
				if (treeRow.ref.libraryID != item.libraryID) {
					let linkedItem = yield item.getLinkedItem(treeRow.ref.libraryID);
					if (linkedItem && !linkedItem.deleted) {
						// For drag to root, skip if linked item exists
						if (treeRow.isLibrary(true)) {
							continue;
						}
						// For drag to collection
						else if (treeRow.isCollection()) {
							// skip if linked item is already in it
							if (treeRow.ref.hasItem(linkedItem.id)) {
								continue;
							}
							// or if linked item is a child item
							else if (!linkedItem.isTopLevelItem()) {
								continue;
							}
						}
					}
					skip = false;
					continue;
				}
				
				// Intra-library drag
				
				// Make sure there's at least one item that's not already
				// in this collection
				if (treeRow.isCollection()) {
					if (treeRow.ref.hasItem(item.id)) {
						Zotero.debug("Item " + item.id + " already exists in collection");
						continue;
					}
					skip = false;
					continue;
				}
			}
			if (skip) {
				Zotero.debug("Drag skipped");
				return false;
			}
		}
		else if (dataType == 'zotero/collection') {
			let draggedCollectionID = data[0];
			let draggedCollection = Zotero.Collections.get(draggedCollectionID);
			
			// Dragging a collection to a different library
			if (treeRow.ref.libraryID != draggedCollection.libraryID) {
				// Disallow if linked collection already exists
				if (yield col.getLinkedCollection(treeRow.ref.libraryID)) {
					return false;
				}
				
				var descendents = yield col.getDescendents(false, 'collection');
				for each(var descendent in descendents) {
					descendent = yield Zotero.Collections.getAsync(descendent.id);
					// Disallow if linked collection already exists for any subcollections
					//
					// If this is allowed in the future for the root collection,
					// need to allow drag only to root
					if (yield descendent.getLinkedCollection(treeRow.ref.libraryID)) {
						return false;
					}
				}
			}
		}
	}
	return true;
});


/*
 *  Called when something's been dropped on or next to a row
 */
Zotero.CollectionTreeView.prototype.drop = Zotero.Promise.coroutine(function* (row, orient, dataTransfer)
{
	if (!this.canDrop(row, orient, dataTransfer)
			|| !(yield this.canDropCheckAsync(row, orient, dataTransfer))) {
		return false;
	}
	
	var dragData = Zotero.DragDrop.getDataFromDataTransfer(dataTransfer);
	if (!dragData) {
		Zotero.debug("No drag data");
		return false;
	}
	var dropEffect = dragData.dropEffect;
	var dataType = dragData.dataType;
	var data = dragData.data;
	var event = Zotero.DragDrop.currentEvent;
	var sourceTreeRow = Zotero.DragDrop.getDragSource(dataTransfer);
	var targetTreeRow = Zotero.DragDrop.getDragTarget(event);
	
	var copyItem = Zotero.Promise.coroutine(function* (item, targetLibraryID) {
		// Check if there's already a copy of this item in the library
		var linkedItem = yield item.getLinkedItem(targetLibraryID);
		if (linkedItem) {
			// If linked item is in the trash, undelete it
			if (linkedItem.deleted) {
				yield linkedItems.loadCollections();
				// Remove from any existing collections, or else when it gets
				// undeleted it would reappear in those collections
				var collectionIDs = linkedItem.getCollections();
				for each(var collectionID in collectionIDs) {
					var col = yield Zotero.Collections.getAsync(collectionID);
					col.removeItem(linkedItem.id);
				}
				linkedItem.deleted = false;
				yield linkedItem.save();
			}
			return linkedItem.id;
			
			/*
			// TODO: support tags, related, attachments, etc.
			
			// Overlay source item fields on unsaved clone of linked item
			var newItem = item.clone(false, linkedItem.clone(true));
			newItem.setField('dateAdded', item.dateAdded);
			newItem.setField('dateModified', item.dateModified);
			
			var diff = newItem.diff(linkedItem, false, ["dateAdded", "dateModified"]);
			if (!diff) {
				// Check if creators changed
				var creatorsChanged = false;
				
				var creators = item.getCreators();
				var linkedCreators = linkedItem.getCreators();
				if (creators.length != linkedCreators.length) {
					Zotero.debug('Creators have changed');
					creatorsChanged = true;
				}
				else {
					for (var i=0; i<creators.length; i++) {
						if (!creators[i].ref.equals(linkedCreators[i].ref)) {
							Zotero.debug('changed');
							creatorsChanged = true;
							break;
						}
					}
				}
				if (!creatorsChanged) {
					Zotero.debug("Linked item hasn't changed -- skipping conflict resolution");
					continue;
				}
			}
			toReconcile.push([newItem, linkedItem]);
			continue;
			*/
		}
		
		// Standalone attachment
		if (item.isAttachment()) {
			var linkMode = item.attachmentLinkMode;
			
			// Skip linked files
			if (linkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE) {
				Zotero.debug("Skipping standalone linked file attachment on drag");
				return false;
			}
			
			if (!targetTreeRow.filesEditable) {
				Zotero.debug("Skipping standalone file attachment on drag");
				return false;
			}
			
			return Zotero.Attachments.copyAttachmentToLibrary(item, targetLibraryID);
		}
		
		// Create new clone item in target library
		// Ensure all data is loaded
		yield item.loadAllData();
		var newItem = item.clone(targetLibraryID, false, !Zotero.Prefs.get('groups.copyTags'));
		var newItemID = yield newItem.save();
		newItem = yield Zotero.Items.getAsync(newItemID);
		
		// Record link
		yield newItem.addLinkedItem(item);
		
		if (item.isNote()) {
			return newItemID;
		}
		
		// For regular items, add child items if prefs and permissions allow
		
		// Child notes
		if (Zotero.Prefs.get('groups.copyChildNotes')) {
			var noteIDs = item.getNotes();
			var notes = yield Zotero.Items.getAsync(noteIDs);
			for each(var note in notes) {
				yield note.loadAllData();
				let newNote = note.clone(targetLibraryID);
				newNote.parentID = newItemID;
				let newNoteID = yield newNote.save();
				newNote = yield Zotero.Items.getAsync(newNoteID);
				
				yield newNote.addLinkedItem(note);
			}
		}
		
		// Child attachments
		var copyChildLinks = Zotero.Prefs.get('groups.copyChildLinks');
		var copyChildFileAttachments = Zotero.Prefs.get('groups.copyChildFileAttachments');
		if (copyChildLinks || copyChildFileAttachments) {
			var attachmentIDs = item.getAttachments();
			var attachments = yield Zotero.Items.getAsync(attachmentIDs);
			for each(var attachment in attachments) {
				var linkMode = attachment.attachmentLinkMode;
				
				// Skip linked files
				if (linkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE) {
					Zotero.debug("Skipping child linked file attachment on drag");
					continue;
				}
				
				// Skip imported files if we don't have pref and permissions
				if (linkMode == Zotero.Attachments.LINK_MODE_LINKED_URL) {
					if (!copyChildLinks) {
						Zotero.debug("Skipping child link attachment on drag");
						continue;
					}
				}
				else {
					if (!copyChildFileAttachments || !targetTreeRow.filesEditable) {
						Zotero.debug("Skipping child file attachment on drag");
						continue;
					}
				}
				
				Zotero.Attachments.copyAttachmentToLibrary(attachment, targetLibraryID, newItem.id);
			}
		}
		
		return newItemID;
	});
	
	var targetLibraryID = targetTreeRow.ref.libraryID;
	var targetCollectionID = targetTreeRow.isCollection() ? targetTreeRow.ref.id : false;
	
	if (dataType == 'zotero/collection') {
		var droppedCollection = yield Zotero.Collections.getAsync(data[0]);
		
		// Collection drag between libraries
		if (targetLibraryID != droppedCollection.libraryID) {
			yield Zotero.DB.executeTransaction(function* () {
				var copyCollections = Zotero.Promise.coroutine(function* (descendents, parentID, addItems) {
					for each(var desc in descendents) {
						// Collections
						if (desc.type == 'collection') {
							var c = yield Zotero.Collections.getAsync(desc.id);
							
							var newCollection = new Zotero.Collection;
							newCollection.libraryID = targetLibraryID;
							yield c.loadAllData();
							c.clone(false, newCollection);
							if (parentID) {
								newCollection.parentID = parentID;
							}
							var collectionID = yield newCollection.save();
							
							// Record link
							c.addLinkedCollection(newCollection);
							
							// Recursively copy subcollections
							if (desc.children.length) {
								yield copyCollections(desc.children, collectionID, addItems);
							}
						}
						// Items
						else {
							var item = yield Zotero.Items.getAsync(desc.id);
							var id = yield copyItem(item, targetLibraryID);
							// Standalone attachments might not get copied
							if (!id) {
								continue;
							}
							// Mark copied item for adding to collection
							if (parentID) {
								if (!addItems[parentID]) {
									addItems[parentID] = [];
								}
								addItems[parentID].push(id);
							}
						}
					}
				});
				
				var collections = [{
					id: droppedCollection.id,
					children: droppedCollection.getDescendents(true),
					type: 'collection'
				}];
				
				var addItems = {};
				yield copyCollections(collections, targetCollectionID, addItems);
				for (var collectionID in addItems) {
					var collection = yield Zotero.Collections.getAsync(collectionID);
					yield collection.addItems(addItems[collectionID]);
				}
				
				// TODO: add subcollections and subitems, if they don't already exist,
				// and display a warning if any of the subcollections already exist
			});
		}
		// Collection drag within a library
		else {
			droppedCollection.parentID = targetCollectionID;
			yield droppedCollection.save();
		}
	}
	else if (dataType == 'zotero/item') {
		var ids = data;
		if (ids.length < 1) {
			return;
		}
		
		if (targetTreeRow.isBucket()) {
			targetTreeRow.ref.uploadItems(ids);
			return;
		}
		
		yield Zotero.DB.executeTransaction(function* () {
			var items = yield Zotero.Items.getAsync(ids);
			if (!items) {
				return;
			}
			
			var newItems = [];
			var newIDs = [];
			var toMove = [];
			// TODO: support items coming from different sources?
			if (items[0].libraryID == targetLibraryID) {
				var sameLibrary = true;
			}
			else {
				var sameLibrary = false;
			}
			
			for each(var item in items) {
				if (!item.isTopLevelItem()) {
					continue;
				}
				
				if (sameLibrary) {
					newIDs.push(item.id);
					toMove.push(item.id);
				}
				else {
					newItems.push(item);
				}
			}
			
			if (!sameLibrary) {
				var toReconcile = [];
				
				var newIDs = [];
				for each(var item in newItems) {
					var id = yield copyItem(item, targetLibraryID)
					// Standalone attachments might not get copied
					if (!id) {
						continue;
					}
					newIDs.push(id);
				}
				
				if (toReconcile.length) {
					var sourceName = items[0].libraryID ? Zotero.Libraries.getName(items[0].libraryID)
										: Zotero.getString('pane.collections.library');
					var targetName = targetLibraryID ? Zotero.Libraries.getName(libraryID)
										: Zotero.getString('pane.collections.library');
					
					var io = {
						dataIn: {
							type: "item",
							captions: [
								// TODO: localize
								sourceName,
								targetName,
								"Merged Item"
							],
							objects: toReconcile
						}
					};
					
					/*
					if (type == 'item') {
						if (!Zotero.Utilities.isEmpty(changedCreators)) {
							io.dataIn.changedCreators = changedCreators;
						}
					}
					*/
					
					var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
							   .getService(Components.interfaces.nsIWindowMediator);
					var lastWin = wm.getMostRecentWindow("navigator:browser");
					lastWin.openDialog('chrome://zotero/content/merge.xul', '', 'chrome,modal,centerscreen', io);
					
					for each(var obj in io.dataOut) {
						yield obj.ref.save();
					}
				}
			}
			
			// Add items to target collection
			if (targetCollectionID) {
				var collection = yield Zotero.Collections.getAsync(targetCollectionID);
				Zotero.debug('adding');
				yield collection.addItems(newIDs);
				Zotero.debug('added');
			}
			
			// If moving, remove items from source collection
			if (dropEffect == 'move' && toMove.length) {
				if (!sameLibrary) {
					throw new Error("Cannot move items between libraries");
				}
				if (!sourceTreeRow || !sourceTreeRow.isCollection()) {
					throw new Error("Drag source must be a collection for move action");
				}
				yield sourceTreeRow.ref.removeItems(toMove);
			}
		});
	}
	else if (dataType == 'text/x-moz-url' || dataType == 'application/x-moz-file') {
		var targetLibraryID = targetTreeRow.ref.libraryID;
		
		if (targetTreeRow.isCollection()) {
			var parentCollectionID = targetTreeRow.ref.id;
		}
		else {
			var parentCollectionID = false;
		}
		
		var unlock = Zotero.Notifier.begin(true);
		try {
			for (var i=0; i<data.length; i++) {
				var file = data[i];
				
				if (dataType == 'text/x-moz-url') {
					var url = data[i];
					
					if (url.indexOf('file:///') == 0) {
						var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
								   .getService(Components.interfaces.nsIWindowMediator);
						var win = wm.getMostRecentWindow("navigator:browser");
						// If dragging currently loaded page, only convert to
						// file if not an HTML document
						if (win.content.location.href != url ||
								win.content.document.contentType != 'text/html') {
							var nsIFPH = Components.classes["@mozilla.org/network/protocol;1?name=file"]
									.getService(Components.interfaces.nsIFileProtocolHandler);
							try {
								var file = nsIFPH.getFileFromURLSpec(url);
							}
							catch (e) {
								Zotero.debug(e);
							}
						}
					}
					
					// Still string, so remote URL
					if (typeof file == 'string') {
						var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
								   .getService(Components.interfaces.nsIWindowMediator);
						var win = wm.getMostRecentWindow("navigator:browser");
						win.ZoteroPane.addItemFromURL(url, 'temporaryPDFHack', null, row); // TODO: don't do this
						continue;
					}
					
					// Otherwise file, so fall through
				}
				
				yield Zotero.DB.executeTransaction(function* () {
					if (dropEffect == 'link') {
						var itemID = Zotero.Attachments.linkFromFile(file);
					}
					else {
						var itemID = Zotero.Attachments.importFromFile(file, false, targetLibraryID);
						// If moving, delete original file
						if (dragData.dropEffect == 'move') {
							try {
								file.remove(false);
							}
							catch (e) {
								Components.utils.reportError("Error deleting original file " + file.path + " after drag");
							}
						}
					}
					if (parentCollectionID) {
						var col = yield Zotero.Collections.getAsync(parentCollectionID);
						if (col) {
							col.addItem(itemID);
						}
					}
				});
			}
		}
		finally {
			Zotero.Notifier.commit(unlock);
		}
	}
});



////////////////////////////////////////////////////////////////////////////////
///
///  Functions for nsITreeView that we have to stub out.
///
////////////////////////////////////////////////////////////////////////////////

Zotero.CollectionTreeView.prototype.isSorted = function() 							{ return false; }

/* Set 'highlighted' property on rows set by setHighlightedRows */
Zotero.CollectionTreeView.prototype.getRowProperties = function(row, prop) {
	var props = [];
	
	if (this._highlightedRows[row]) {
		// <=Fx21
		if (prop) {
			var aServ = Components.classes["@mozilla.org/atom-service;1"].
				getService(Components.interfaces.nsIAtomService);
			prop.AppendElement(aServ.getAtom("highlighted"));
		}
		// Fx22+
		else {
			props.push("highlighted");
		}
	}
	
	return props.join(" ");
}

Zotero.CollectionTreeView.prototype.getColumnProperties = function(col, prop) 		{ }
Zotero.CollectionTreeView.prototype.getCellProperties = function(row, col, prop) 	{ }
Zotero.CollectionTreeView.prototype.isSeparator = function(index) {
	var source = this.getRow(index);
	return source.type == 'separator';
}
Zotero.CollectionTreeView.prototype.performAction = function(action) 				{ }
Zotero.CollectionTreeView.prototype.performActionOnCell = function(action, row, col)	{ }
Zotero.CollectionTreeView.prototype.getProgressMode = function(row, col) 			{ }
Zotero.CollectionTreeView.prototype.cycleHeader = function(column)					{ }


Zotero.CollectionTreeCache = {
	"lastTreeRow":null,
	"lastTempTable":null,
	"lastSearch":null,
	"lastResults":null,
	
	"clear":function() {
		this.lastTreeRow = null;
		this.lastSearch = null;
		if(this.lastTempTable) {
			Zotero.DB.queryAsync("DROP TABLE " + this.lastTempTable);
		}
		this.lastTempTable = null;
		this.lastResults = null;
	}
};

Zotero.CollectionTreeRow = function(type, ref)
{
	this.type = type;
	this.ref = ref;
}


Zotero.CollectionTreeRow.prototype.__defineGetter__('id', function () {
	switch (this.type) {
		case 'library':
			return 'L';
		
		case 'feedLibrary':
			return 'FL';
		
		case 'feed':
		case 'collection':
			return 'C' + this.ref.id;
		
		case 'search':
			return 'S' + this.ref.id;
		
		case 'duplicates':
			return 'D' + this.ref.libraryID;
		
		case 'unfiled':
			return 'U' + this.ref.libraryID;
		
		case 'trash':
			return 'T' + this.ref.libraryID;
		
		case 'header':
			if (this.ref.id == 'group-libraries-header') {
				return 'HG';
			}
			break;
		
		case 'group':
			return 'G' + this.ref.id;
	}
	
	return '';
});

Zotero.CollectionTreeRow.prototype.isLibrary = function (includeGlobal)
{
	if (includeGlobal) {
		return this.type == 'library' || this.type == 'group' || this.type == 'feedLibrary';
	}
	return this.type == 'library';
}

Zotero.CollectionTreeRow.prototype.isCollection = function(includeFeeds)
{
	return this.type == 'collection' || (includeFeeds && this.isFeed());
}

Zotero.CollectionTreeRow.prototype.isFeed = function()
{
	return this.type == 'feed';
}

Zotero.CollectionTreeRow.prototype.isSearch = function()
{
	return this.type == 'search';
}

Zotero.CollectionTreeRow.prototype.isDuplicates = function () {
	return this.type == 'duplicates';
}

Zotero.CollectionTreeRow.prototype.isUnfiled = function () {
	return this.type == 'unfiled';
}

Zotero.CollectionTreeRow.prototype.isTrash = function()
{
	return this.type == 'trash';
}

Zotero.CollectionTreeRow.prototype.isHeader = function () {
	return this.type == 'header';
}

Zotero.CollectionTreeRow.prototype.isGroup = function() {
	return this.type == 'group';
}

Zotero.CollectionTreeRow.prototype.isFeedLibrary = function() {
	return this.type == 'feedLibrary';
}

Zotero.CollectionTreeRow.prototype.isSeparator = function () {
	return this.type == 'separator';
}

Zotero.CollectionTreeRow.prototype.isBucket = function()
{
	return this.type == 'bucket';
}

Zotero.CollectionTreeRow.prototype.isShare = function()
{
	return this.type == 'share';
}



// Special
Zotero.CollectionTreeRow.prototype.isWithinGroup = function () {
	return this.ref && Zotero.Libraries.isGroupLibrary(this.ref.libraryID);
}

Zotero.CollectionTreeRow.prototype.isWithinEditableGroup = function () {
	if (!this.isWithinGroup()) {
		return false;
	}
	var groupID = Zotero.Groups.getGroupIDFromLibraryID(this.ref.libraryID);
	return Zotero.Groups.get(groupID).editable;
}

Zotero.CollectionTreeRow.prototype.isWithinFeedLibrary = function() {
	return this.ref && this.ref.libraryID == Zotero.Libraries.feedLibraryID;
}

Zotero.CollectionTreeRow.prototype.__defineGetter__('editable', function () {
	if (this.isTrash() || this.isShare() || this.isBucket()) {
		return false;
	}
	
	if (this.isWithinFeedLibrary()) {
		return false;
	}
	
	if (!this.isWithinGroup()) {
		return true;
	}
	var libraryID = this.ref.libraryID;
	if (this.isGroup()) {
		return this.ref.editable;
	}
	if (this.isCollection() || this.isSearch() || this.isDuplicates() || this.isUnfiled()) {
		var type = Zotero.Libraries.getType(libraryID);
		if (type == 'group') {
			var groupID = Zotero.Groups.getGroupIDFromLibraryID(libraryID);
			var group = Zotero.Groups.get(groupID);
			return group.editable;
		}
		throw ("Unknown library type '" + type + "' in Zotero.CollectionTreeRow.editable");
	}
	return false;
});

Zotero.CollectionTreeRow.prototype.__defineGetter__('filesEditable', function () {
	if (this.isTrash() || this.isShare()) {
		return false;
	}
	
	if (this.isWithinFeedLibrary()) {
		return false;
	}
	
	if (!this.isWithinGroup()) {
		return true;
	}
	var libraryID = this.ref.libraryID;
	if (this.isGroup()) {
		return this.ref.filesEditable;
	}
	if (this.isCollection() || this.isSearch() || this.isDuplicates() || this.isUnfiled()) {
		var type = Zotero.Libraries.getType(libraryID);
		if (type == 'group') {
			var groupID = Zotero.Groups.getGroupIDFromLibraryID(libraryID);
			var group = Zotero.Groups.get(groupID);
			return group.filesEditable;
		}
		throw ("Unknown library type '" + type + "' in Zotero.CollectionTreeRow.filesEditable");
	}
	return false;
});

Zotero.CollectionTreeRow.prototype.getName = function()
{
	switch (this.type) {
		case 'library':
			return Zotero.getString('pane.collections.library');
		
		case 'feedLibrary':
			return Zotero.getString('pane.collections.feedLibrary');
		
		case 'trash':
			return Zotero.getString('pane.collections.trash');
		
		case 'header':
			return this.ref.label;
		
		case 'separator':
			return "";
		
		default:
			return this.ref.name;
	}
}

Zotero.CollectionTreeRow.prototype.getItems = Zotero.Promise.coroutine(function* ()
{
	switch (this.type) {
		// Fake results if this is a shared library
		case 'share':
			return this.ref.getAll();
		
		case 'bucket':
			return this.ref.getItems();
		
		case 'header':
			return [];
	}
	
	var ids = yield this.getSearchResults();
	if (!ids.length) {
		return []
	}
	return Zotero.Items.get(ids);
});

Zotero.CollectionTreeRow.prototype.getSearchResults = Zotero.Promise.coroutine(function* (asTempTable) {
	if(Zotero.CollectionTreeCache.lastTreeRow !== this) {
		Zotero.CollectionTreeCache.clear();
	}
	
	if(!Zotero.CollectionTreeCache.lastResults) {
		var s = yield this.getSearchObject();
		
		// FIXME: Hack to exclude group libraries for now
		if (this.isSearch()) {
			var currentLibraryID = this.ref.libraryID;
			if (Zotero.Libraries.isGroupLibrary(currentLibraryID)
				|| currentLibraryID == Zotero.Libraries.feedLibraryID
			) {
				yield s.addCondition('libraryID', 'is', currentLibraryID);
			}
			else {
				var groups = yield Zotero.Groups.getAll();
				for each(var group in groups) {
					yield s.addCondition('libraryID', 'isNot', group.libraryID);
				}
				yield s.addCondition('libraryID', 'isNot', Zotero.Libraries.feedLibraryID);
			}
		}
		
		Zotero.CollectionTreeCache.lastResults = yield s.search();
		Zotero.CollectionTreeCache.lastTreeRow = this;
	}
	
	if(asTempTable) {
		if(!Zotero.CollectionTreeCache.lastTempTable) {
			Zotero.CollectionTreeCache.lastTempTable = yield Zotero.Search.idsToTempTable(Zotero.CollectionTreeCache.lastResults);
		}
		return Zotero.CollectionTreeCache.lastTempTable;
	}
	return Zotero.CollectionTreeCache.lastResults;
});

/*
 * Returns the search object for the currently display
 *
 * This accounts for the collection, saved search, quicksearch, tags, etc.
 */
Zotero.CollectionTreeRow.prototype.getSearchObject = Zotero.Promise.coroutine(function* () {
	if(Zotero.CollectionTreeCache.lastTreeRow !== this) {
		Zotero.CollectionTreeCache.clear();
	}
	
	if(Zotero.CollectionTreeCache.lastSearch) {
		return Zotero.CollectionTreeCache.lastSearch;
	}	
	
	var includeScopeChildren = false;
	
	// Create/load the inner search
	if (this.ref instanceof Zotero.Search) {
		var s = this.ref;
	}
	else if (this.isDuplicates()) {
		var s = yield this.ref.getSearchObject();
	}
	else {
		var s = new Zotero.Search();
		yield s.addCondition('libraryID', 'is', this.ref.libraryID);
		// Library root
		if (this.isLibrary(true)) {
			yield s.addCondition('noChildren', 'true');
			includeScopeChildren = true;
		}
		else if (this.isCollection(true)) {
			yield s.addCondition('noChildren', 'true');
			yield s.addCondition('collectionID', 'is', this.ref.id);
			if (Zotero.Prefs.get('recursiveCollections')) {
				yield s.addCondition('recursive', 'true');
			}
			includeScopeChildren = true;
		}
		else if (this.isTrash()) {
			yield s.addCondition('deleted', 'true');
		}
		else {
			throw ('Invalid search mode in Zotero.CollectionTreeRow.getSearchObject()');
		}
	}
	
	// Create the outer (filter) search
	var s2 = new Zotero.Search();
	if (this.isTrash()) {
		yield s2.addCondition('deleted', 'true');
	}
	s2.setScope(s, includeScopeChildren);
	
	if (this.searchText) {
		var cond = 'quicksearch-' + Zotero.Prefs.get('search.quicksearch-mode');
		yield s2.addCondition(cond, 'contains', this.searchText);
	}
	
	if (this.tags){
		for (var tag in this.tags){
			if (this.tags[tag]){
				yield s2.addCondition('tag', 'is', tag);
			}
		}
	}
	
	Zotero.CollectionTreeCache.lastTreeRow = this;
	Zotero.CollectionTreeCache.lastSearch = s2;
	return s2;
});


/**
 * Returns all the tags used by items in the current view
 *
 * @return {Promise}
 */
Zotero.CollectionTreeRow.prototype.getChildTags = Zotero.Promise.method(function () {
	switch (this.type) {
		// TODO: implement?
		case 'share':
			return false;
		
		case 'bucket':
			return false;
		
		case 'header':
			return false;
	}
	
	return Zotero.Tags.getAllWithinSearchResults(this.getSearchResults(true));
});


Zotero.CollectionTreeRow.prototype.setSearch = function(searchText)
{
	Zotero.CollectionTreeCache.clear();
	this.searchText = searchText;
}

Zotero.CollectionTreeRow.prototype.setTags = function(tags)
{
	Zotero.CollectionTreeCache.clear();
	this.tags = tags;
}

/*
 * Returns TRUE if saved search, quicksearch or tag filter
 */
Zotero.CollectionTreeRow.prototype.isSearchMode = function() {
	switch (this.type) {
		case 'search':
		case 'trash':
			return true;
	}
	
	// Quicksearch
	if (this.searchText != '') {
		return true;
	}
	
	// Tag filter
	if (this.tags) {
		for (var i in this.tags) {
			return true;
		}
	}
}
