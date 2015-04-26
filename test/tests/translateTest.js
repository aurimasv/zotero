Components.utils.import("resource://gre/modules/osfile.jsm");

describe("Zotero.Translate.ItemGetter", function() {
	describe("nextItem", function() {
		let sqlDateTimeRe = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
		let isoDateTimeRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
		
		it('should return false for an empty database', function() {
			let getter = new Zotero.Translate.ItemGetter();
			assert.isFalse(getter.nextItem());
		});
		it('should return items in order they are supplied', function() {
			let getter = new Zotero.Translate.ItemGetter();
			Zotero.DB.beginTransaction();
			let itemIDs = [
				(new Zotero.Item('journalArticle')).save(),
				(new Zotero.Item('book')).save()
			];
			Zotero.DB.commitTransaction();
			
			let items = [ Zotero.Items.get(itemIDs[0]), Zotero.Items.get(itemIDs[1]) ];
			let itemURIs = items.map(i => Zotero.URI.getItemURI(i));
			
			getter._itemsLeft = items;
			
			assert.equal(getter.nextItem().uri, itemURIs[0], 'first item comes out first');
			assert.equal(getter.nextItem().uri, itemURIs[1], 'second item comes out second');
			assert.isFalse(getter.nextItem(), 'end of item queue');
		});
		it.skip('field mappings for all item types are tested in support.js'); // Just a note
		it('should return items with tags in expected format', function() {
			let getter = new Zotero.Translate.ItemGetter();
			
			let itemWithAutomaticTag = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			itemWithAutomaticTag.addTag('automatic tag', 0);
			
			let itemWithManualTag = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			itemWithManualTag.addTag('manual tag', 1);
			
			let itemWithMultipleTags = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			itemWithMultipleTags.addTag('tag1', 0);
			itemWithMultipleTags.addTag('tag2', 1);
			
			let legacyMode = [false, true];
			for (let i=0; i<legacyMode.length; i++) {
				getter._itemsLeft = [itemWithAutomaticTag, itemWithManualTag, itemWithMultipleTags];
				getter.legacy = legacyMode[i];
				let suffix = legacyMode[i] ? ' in legacy mode' : '';
				
				// itemWithAutomaticTag
				let translatorItem = getter.nextItem();
				assert.isArray(translatorItem.tags, 'item contains automatic tags in an array' + suffix);
				assert.isObject(translatorItem.tags[0], 'automatic tag is an object' + suffix);
				assert.equal(translatorItem.tags[0].tag, 'automatic tag', 'automatic tag name provided as "tag" property' + suffix);
				if (legacyMode[i]) {
					assert.equal(translatorItem.tags[0].type, 0, 'automatic tag "type" is 0' + suffix);
				} else {
					assert.isUndefined(translatorItem.tags[0].type, '"type" is undefined for automatic tag' + suffix);
				}
				
				// itemWithManualTag
				translatorItem = getter.nextItem();
				assert.isArray(translatorItem.tags, 'item contains manual tags in an array' + suffix);
				assert.isObject(translatorItem.tags[0], 'manual tag is an object' + suffix);
				assert.equal(translatorItem.tags[0].tag, 'manual tag', 'manual tag name provided as "tag" property' + suffix);
				assert.equal(translatorItem.tags[0].type, 1, 'manual tag "type" is 1' + suffix);
				
				// itemWithMultipleTags
				translatorItem = getter.nextItem();
				assert.isArray(translatorItem.tags, 'item contains multiple tags in an array' + suffix);
				assert.lengthOf(translatorItem.tags, 2, 'expected number of tags returned' + suffix);
			}
		});
		it.skip('should return item collections in expected format');
		it.skip('should return item relations in expected format');
		it.skip('should return standalone notes in expected format');
		it('should return stored/linked file and URI attachments in expected format', Q.async(function () {
			let getter = new Zotero.Translate.ItemGetter();
			
			let file = getTestDataDirectory();
			file.append("empty.pdf");
			let item = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			let relatedItem = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			
			// Attachment items
			let attachmentLinkModes = ['stored', 'linked', 'attachedStored', 'attachedLinked', 'attachedURI']; // These must match attachments array
			let attachments = [
				Zotero.Items.get(Zotero.Attachments.importFromFile(file)),
				Zotero.Items.get(Zotero.Attachments.linkFromFile(file)),
				Zotero.Items.get(Zotero.Attachments.importFromFile(file, item.id)),
				Zotero.Items.get(Zotero.Attachments.linkFromFile(file, item.id)),
				Zotero.Items.get(Zotero.Attachments.linkFromURL('http://example.com', item.id, 'application/pdf', 'empty.pdf'))
			];
			
			// Make sure all fields are populated
			for (let i=0; i<attachments.length; i++) {
				let attachment = attachments[i];
				attachment.setField('accessDate', '2001-02-03 12:13:14');
				attachment.attachmentCharset = Zotero.CharacterSets.getID('utf-8');
				attachment.setField('url', 'http://example.com');
				attachment.setNote('note');
			
				attachment.addTag('automaticTag', 0);
				attachment.addTag('manualTag', 1);
			
				attachment.addRelatedItem(relatedItem.id);
			
				attachment.save();
			}
			
			// Run tests
			for (let j=0; j<attachmentLinkModes.length; j++) {
				let mode = attachmentLinkModes[j];
				let linkToURL = mode == 'attachedURI';
				let childAttachment = mode.substr(0,8) == 'attached';
				let storedFile = mode.substr(8).toLowerCase() == 'stored';
				
				let prefix = (childAttachment ? 'attached ' : '')
					+ (storedFile ? 'stored ' : 'link to ')
					+ (linkToURL ? 'URL ' : 'file ');
				
				let legacyMode = [false, true];
				for (let i=0; i<legacyMode.length; i++) {
					let legacy = legacyMode[i];
					getter._itemsLeft = [attachments[j]];
					
					let exportDir = yield getTempDirectory();
					getter._exportFileDirectory = Components.classes["@mozilla.org/file/local;1"]
						.createInstance(Components.interfaces.nsILocalFile);
					getter._exportFileDirectory.initWithPath(exportDir);
					
					getter.legacy = legacy;
					let suffix = legacy ? ' in legacy mode' : '';
					
					// Stored file
					let translatorItem = getter.nextItem();
					assert.isObject(translatorItem, 'returns ' + prefix.trim() + suffix);
					
					// Set fields
					assert.equal(translatorItem.itemType, 'attachment', prefix + 'itemType is correct' + suffix);
					assert.equal(translatorItem.title, 'empty.pdf', prefix + 'title is correct' + suffix);
					assert.equal(translatorItem.url, 'http://example.com', prefix + 'url is correct' + suffix);
					assert.equal(translatorItem.accessDate, '2001-02-03 12:13:14', prefix + 'accessDate is correct' + suffix);
					assert.equal(translatorItem.charset, 'utf-8', prefix + 'charset is correct' + suffix);
					assert.equal(translatorItem.note, 'note', prefix + 'note is correct' + suffix);
					assert.equal(translatorItem.uri, Zotero.URI.getItemURI(attachments[j]), prefix + 'uri is correct' + suffix);
					
					// Automatically set fields
					assert.isString(translatorItem.dateAdded, prefix + 'dateAdded is set' + suffix);
					assert.isString(translatorItem.dateModified, prefix + 'dateModified is set' + suffix);
					
					// Legacy mode fields
					if (legacy) {
						assert.isNumber(translatorItem.itemID, prefix + 'itemID is set' + suffix);
						assert.isString(translatorItem.key, prefix + 'key is set' + suffix);
						assert.equal(translatorItem.mimeType, 'application/pdf', prefix + 'mimeType is correct' + suffix);
						
						assert.isTrue(sqlDateTimeRe.test(translatorItem.dateAdded), prefix + 'dateAdded matches SQL format' + suffix);
						assert.isTrue(sqlDateTimeRe.test(translatorItem.dateModified), prefix + 'dateModified matches SQL format' + suffix);
					} else {
						assert.equal(translatorItem.contentType, 'application/pdf', prefix + 'contentType is correct' + suffix);
						assert.isTrue(isoDateTimeRe.test(translatorItem.dateAdded), prefix + 'dateAdded matches ISO-8601 format' + suffix);
						assert.isTrue(isoDateTimeRe.test(translatorItem.dateModified), prefix + 'dateModified matches ISO-8601 format' + suffix);
					}
					
					if (!linkToURL) {
						// localPath
						assert.isString(translatorItem.localPath, prefix + 'localPath is set' + suffix);
						let attachmentFile = Components.classes["@mozilla.org/file/local;1"]
							.createInstance(Components.interfaces.nsILocalFile);
						attachmentFile.initWithPath(translatorItem.localPath);
						assert.isTrue(attachmentFile.exists(), prefix + 'localPath points to a file' + suffix);
						assert.isTrue(attachmentFile.equals(attachments[j].getFile(null, true)), prefix + 'localPath points to the correct file' + suffix);
						
						assert.equal(translatorItem.filename, 'empty.pdf', prefix + 'filename is correct' + suffix);
						assert.equal(translatorItem.defaultPath, 'files/' + attachments[j].id + '/' + translatorItem.filename, prefix + 'defaultPath is correct' + suffix);
						
						// saveFile function
						assert.isFunction(translatorItem.saveFile, prefix + 'has saveFile function' + suffix);
						translatorItem.saveFile(translatorItem.defaultPath);
						assert.equal(translatorItem.path, OS.Path.join(exportDir, OS.Path.normalize(translatorItem.defaultPath)), prefix + 'path is set correctly after saveFile call' + suffix);
						
						let fileExists = yield OS.File.exists(translatorItem.path);
						assert.isTrue(fileExists, prefix + 'file was copied to the correct path by saveFile function' + suffix);
						fileExists = yield OS.File.exists(translatorItem.localPath);
						assert.isTrue(fileExists, prefix + 'file was not removed from original location' + suffix);
						
						assert.throws(translatorItem.saveFile.bind(translatorItem, translatorItem.defaultPath), /^ERROR_FILE_EXISTS /, prefix + 'saveFile does not overwrite existing file by default' + suffix);
						assert.throws(translatorItem.saveFile.bind(translatorItem, 'file/../../'), /./, prefix + 'saveFile does not allow exporting outside export directory' + suffix);
						/** TODO: check if overwriting existing file works **/
					}
					
					// Tags
					assert.isArray(translatorItem.tags, prefix + 'contains tags as array' + suffix);
					assert.equal(translatorItem.tags.length, 2, prefix + 'contains correct number of tags' + suffix);
					let possibleTags = [
						{ tag: 'automaticTag', type: 0 },
						{ tag: 'manualTag', type: 1 }
					];
					for (let i=0; i<possibleTags.length; i++) {
						let match = false;
						for (let j=0; j<translatorItem.tags.length; j++) {
							if (possibleTags[i].tag == translatorItem.tags[j].tag) {
								let type = possibleTags[i].type;
								if (!legacy && type == 0) type = undefined;
								
								assert.equal(translatorItem.tags[j].type, type, prefix + possibleTags[i].tag + ' tag is correct' + suffix);
								match = true;
								break;
							}
						}
						assert.isTrue(match, prefix + ' has ' + possibleTags[i].tag + ' tag ' + suffix);
					}
					
					// Relations
					assert.isObject(translatorItem.relations, prefix + 'has relations as object' + suffix);
					assert.equal(translatorItem.relations['dc:relation'], Zotero.URI.getItemURI(relatedItem), prefix + 'relation is correct' + suffix);
					/** TODO: test other relations and multiple relations per predicate (should be an array) **/
				}
			}
		}));
	});
});