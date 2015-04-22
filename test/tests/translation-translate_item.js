describe("Zotero.Translate.ItemGetter", function() {
	describe("nextItem", function() {
		let getter = new Zotero.Translate.ItemGetter();
		let legacyMode = [false, true];
		it('should return false for an empty database', function() {
			assert.isFalse(getter.nextItem());
		});
		it('should return items in order they are supplied', function() {
			Zotero.DB.begintTransaction();
			let itemIDs = [
				(new Zotero.Item('journalArticle')).save(),
				(new Zotero.Item('book')).save()
			];
			Zotero.DB.commitTransaction();
			
			let items = [ Zotero.Items.get(itemIDs[0]), Zotero.Items.get(itemIDs[1]) ];
			let itemURIs = items.map(i => Zotero.URI.getItemURI(i));
			
			getter._itemsLeft = items;
			
			assert.equal(getter.nextItem().uri, itemURIs[0], 'first item comes out first');
			assert.equal(getter.nextItem().uri, itemURIs[0], 'second item comes out second');
			assert.isFalse(getter.nextItem(), 'end of item queue');
		});
		it.skip('field mappings for all item types are tested in support.js');
		it('should return items with tags in expected format', function() {
			let itemWithAutomaticTag = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			itemWithAutomaticTag.addTag('automatic tag', 0);
			let itemWithManualTag = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			itemWithManualTag.addTag('manual tag', 1);
			let itemWithMultipleTags = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			itemWithMultipleTags.addTag('tag1', 0);
			itemWithMultipleTags.addTag('tag2', 1);
			
			for (let i=0; i<legacyMode.length; i++) {
				getter._itemsLeft = [itemWithAutomaticTag, itemWithManualTag, itemWithMultipleTags];
				getter.legacy = legacyMode[i];
				let suffix = legacyMode[i] ? ' in legacy mode' : '';
				
				let translatorItem = getter.nextItem();
				assert.isArray(translatorItem.tags, 'item contains automatic tags in an array' + suffix);
				assert.isObject(translatorItem.tags[0], 'automatic tag is an object' + suffix);
				assert.isEqual(translatorItem.tags[0].tag, 'automatic tag', 'automatic tag name provided as "tag" property' + suffix);
				assert.isEqual(translatorItem.tags[0].type, 0, 'automatic tag "type" is 0' + suffix);
				
				translatorItem = getter.nextItem();
				assert.isArray(translatorItem.tags, 'item contains manual tags in an array' + suffix);
				assert.isObject(translatorItem.tags[0], 'manual tag is an object' + suffix);
				assert.isEqual(translatorItem.tags[0].tag, 'manual tag', 'manual tag name provided as "tag" property' + suffix);
				assert.isEqual(translatorItem.tags[0].type, 1, 'manual tag "type" is 1' + suffix);
				
				translatorItem = getter.nextItem();
				assert.isArray(translatorItem.tags, 'item contains multiple tags in an array' + suffix);
				assert.lengthOf(translatorItem.tags, 2, 'expected number of tags returned' + suffix);
			}
		});
		it('should return items with attachments in expected format', function() {
			let item = Zotero.Items.get((new Zotero.Item('journalArticle')).save());
			let attachments = 
		});
		it('should return item collections in expected format');
		it('should return item relations in expected format');
		/** TODO: test attachment functions **/
	});