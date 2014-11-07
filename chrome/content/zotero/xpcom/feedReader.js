/**
 * Sample feeds:
 * 
 * http://cyber.law.harvard.edu/rss/examples/rss2sample.xml
 * http://feeds.feedburner.com/acs/acbcct
 * http://www.cell.com/molecular-cell/current.rss
 * http://ieeexplore.ieee.org/search/searchresult.jsp?searchField%3DSearch_All%26queryText%3Dwater&searchOrigin=saved_searches&rssFeed=true&rssFeedName=water
 * http://www.sciencemag.org/rss/current.xml
 * http://rss.sciencedirect.com/publication/science/20925212
 * http://www.ncbi.nlm.nih.gov/entrez/eutils/erss.cgi?rss_guid=1fmfIeN4X5Q8HemTZD5Rj6iu6-FQVCn7xc7_IPIIQtS1XiD9bf
 * http://export.arxiv.org/rss/astro-ph
 */

/**
 * class Zotero.FeedReader
 * Asynchronously reads an ATOM/RSS feed
 *
 * @param {String} url URL of the feed
 *
 * @method {Zotero.Promise<FeedProperties>} getFeedProperties An object
 *   representing feed properties
 * @method {Zotero.Promise<FeedItem>*} createItemIterator Returns an iterator
 *   for feed items. The iterator returns FeedItem promises that have to be
 *   resolved before requesting the next promise. When all items are exhausted.
 *   the promise resolves to null.
 * @method {void} terminate Stops retrieving/parsing the feed. Data parsed up
 *   to this point is still available.
 */
Zotero.FeedReader = function(url) {
	if (!url) throw new Error("Feed URL must be supplied");
	
	let ios = Components.classes["@mozilla.org/network/io-service;1"]
		.getService(Components.interfaces.nsIIOService);
	
	let feedUrl = ios.newURI(url, null, null);
	let feed = Zotero.Promise.defer();
	let feedItems = [];
	
	let channel = ios.newChannelFromURI(feedUrl);
	
	let feedProcessor = Components.classes["@mozilla.org/feed-processor;1"]
		.createInstance(Components.interfaces.nsIFeedProcessor);
	feedProcessor.parseAsync(null, feedUrl);
	feedProcessor.listener = {
		/*
		 * MDN suggests that we could use nsIFeedProgressListener to handle the feed
		 * as it gets loaded, but this is actually not implemented (as of 32.0.3),
		 * so we have to load the whole feed and handle it in handleResult.
		 */
		handleResult: (result) => {
			if (!result.doc) {
				this.terminate("No Feed");
				return;
			}
			
			let newFeed = result.doc.QueryInterface(Components.interfaces.nsIFeed);
			feed.resolve(newFeed);
			
			let items = newFeed.items;
			if (items && items.length) {
				let feedInfo = getFeedInfo(newFeed);
				for (let i=0; i<items.length; i++) {
					let item = items.queryElementAt(i, Components.interfaces.nsIFeedEntry);
					if (!item) continue;
					
					let feedItem = getFeedItem(item, feedInfo);
					if (!feedItem) continue;
					
					feedItems.push(Zotero.Promise.resolve(feedItem));
				}
			}
		}
	};
	
	let feedInfo = null;
	let getFeedInfo = function(feed) {
		if (feedInfo) return feedInfo;
		
		let info = {};

		let title = feed.title || '';
		if (title) title = title.plainText();
		info.title = title;

		let subtitle = feed.subtitle || '';
		if (subtitle) subtitle = subtitle.plainText();
		info.subtitle = subtitle;

		if (feed.updated) info.updated = new Date(feed.updated);
		

		let rights = feed.rights
		if (rights) rights = rights.plainText();
		if (rights) info.rights = rights;

		// categories: MDN says "not yet implemented"

		info.creators = processCreators(feed, 'authors', 'author');

		// TODO: image as icon
		
		let publicationTitle = getFeedField(feed, 'prism', 'publicationName')
			|| getFeedField(feed, null, 'pubTitle');
		if (publicationTitle) info.publicationTitle = publicationTitle;
		
		let publisher = getFeedField(feed, 'dc', 'publisher');
		if (publisher) info.publisher = publisher;
		
		let rights = getFeedField(feed, 'prism', 'copyright')
			|| getFeedField(feed, 'dc', 'rights')
			|| getFeedField(feed, null, 'copyright');
		if (rights) info.rights = rights;
		
		let issn = getFeedField(feed, 'prism', 'issn');
		if (issn) info.ISSN = issn;
		
		let isbn = getFeedField(feed, 'prism', 'isbn')
			|| getFeedField(feed, null, 'isbn')
		if (isbn) info.ISBN = isbn;
		
		let language = getFeedField(feed, 'dc', 'language')
			|| getFeedField(feed, null, 'language');
		if (language) info.language = language;
		
		let ttl = getFeedField(feed, null, 'ttl');
		if (ttl) info.ttl = ttl;
		
		feedInfo = info;
		return info;
	};
	
	let domDiv = Zotero.Utilities.Internal.getDOMDocument().createElement("div");
	let getRichText = function(feedText, field) {
		let domFragment = feedText.createDocumentFragment(domDiv);
		return Zotero.Utilities.dom2text(domFragment, field);
	};
	
	let ns = {
		'prism': 'null',
		'dc': 'dc:'
	}
	let getFeedField = function(feedEntry, namespace, field) {
		let prefix = namespace ? ns[namespace] || 'null' : '';
		try {
			return feedEntry.fields.getPropertyAsAUTF8String(prefix+field);
		} catch(e) {}
		
		try {
			if (namespace && !ns[namespace]) {
				prefix = namespace + ':';
				return feedEntry.fields.getPropertyAsAUTF8String(prefix+field);
			}
		} catch(e) {}
		
		return;
	}
	
	let getFeedItem = function(feedEntry, feedInfo) {
		let item = {};
		// ID is not required, but most feeds have these and we have to rely on them
		// to handle updating properly
		if (!feedEntry.id) {
			Zotero.debug("FeedReader: Feed item missing an ID");
			return;
		}
		
		item.id = feedEntry.id;
				
		if (feedEntry.title) item.title = getRichText(feedEntry.title, 'title');
		
		if (feedEntry.summary) {
			item.abstractNote = getRichText(feedEntry.summary, 'abstractNote');
			
			if (!item.title) {
				// We will probably have to trim this, so let's use plain text to
				// avoid splitting inside some markup
				let title = Zotero.Utilities.trimInternal(feedEntry.summary.plainText());
				let splitAt = title.lastIndexOf(' ', 50);
				if (splitAt == -1) splitAt = 50;
				
				item.title = title.substr(0, splitAt);
				if (splitAt <= title.length) item.title += '...';
			}
		}
		
		if (feedEntry.link) item.url = feedEntry.link.spec;
		
		if (feedEntry.updated) item.lastModified = new Date(feedEntry.updated);
		
		if (feedEntry.published) {
			let date = new Date(feedEntry.published);
			
			if (!date.getUTCSeconds() && !(date.getUTCHours() && date.getUTCMinutes())) {
				// There was probably no time, but there may have been a a date range,
				// so something could have ended up in the hour _or_ minute field
				item.date = getFeedField(feedEntry, null, 'pubDate')
					/* In case it was magically pulled from some other field */
					|| ( date.getUTCFullYear() + '-'
						+ (date.getUTCMonth() + 1) + '-'
						+  date.getUTCDate() );
			} else {
				item.date = Zotero.Date.dateToSQL(date, false, true);
			}
			
			if (!item.lastModified) {
				items.lastModified = date;
			}
		}
		
		if (!item.lastModified) {
			// When there's no reliable modification date, we can assume that item doesn't get updated
			Zotero.debug("FeedReader: Feed item missing a modification date (" + item.id + ")");
			item.lastModified = null;
		}
		
		if (!item.date && item.lastModified) {
			// Use lastModified date
			item.date = Zotero.Date.dateToSQL(item.lastModified, false, true);
		}
		
		if (feedEntry.rights) item.rights = getRichText(feedEntry.rights, 'rights');
		
		item.creators = processCreators(feedEntry, 'authors', 'author');
		if (!item.creators.length) {
			// Use feed authors as item author. Maybe not the best idea.
			for (let i=0; i<feedInfo.creators.length; i++) {
				if (feedInfo.creators[i].creatorType != 'author') continue;
				item.creators.push(feedInfo.creators[i]);
			}
		}
		
		let contributors = processCreators(feedEntry, 'contributors', 'contributor');
		if (contributors.length) item.creators = item.creators.concat(contributors);
		
		/** Done with basic metadata, now look for better data **/
		
		let date = getFeedField(feedEntry, 'prism', 'publicationDate')
			|| getFeedField(feedEntry, 'dc', 'date');
		if (date) item.date = date;
		
		let publicationTitle = getFeedField(feedEntry, 'prism', 'publicationName')
			|| getFeedField(feedEntry, 'dc', 'source')
			|| getFeedField(feedEntry, null, 'pubTitle');
		if (publicationTitle) item.publicationTitle = publicationTitle;
		
		let publicationType = getFeedField(feedEntry, null, 'pubType');
		if (publicationType) item.publicationType = publicationType;
		
		let startPage = getFeedField(feedEntry, null, 'startPage');
		let endPage = getFeedField(feedEntry, null, 'endPage');
		if (startPage || endPage) {
			item.pages = ( startPage || '' )
				+ ( endPage && startPage ? '–' : '' )
				+ ( endPage || '' );
		}
		
		let issn = getFeedField(feedEntry, 'prism', 'issn');
		if (issn) item.ISSN = issn;
		
		let isbn = getFeedField(feedEntry, 'prism', 'isbn')
			|| getFeedField(feedEntry, null, 'isbn')
		if (isbn) item.ISBN = isbn;
		
		let identifier = getFeedField(feedEntry, 'dc', 'identifier');
		if (identifier) {
			let cleanId = Zotero.Utilities.cleanDOI(identifier);
			if (cleanId) {
				if (!item.DOI) item.DOI = cleanId;
			} else if (cleanId = Zotero.Utilities.cleanISBN(identifier)) {
				if (!item.ISBN) item.ISBN = cleanId;
			} else if (cleanId = Zotero.Utilities.cleanISSN(identifier)) {
				if (!item.ISSN) item.ISSN = cleanId;
			}
		}
		
		let publisher = getFeedField(feedEntry, 'dc', 'publisher');
		if (publisher) item.publisher = publisher;
		
		let rights = getFeedField(feedEntry, 'prism', 'copyright')
			|| getFeedField(feedEntry, 'dc', 'rights')
			|| getFeedField(feedEntry, null, 'copyright');
		if (rights) item.rights = rights;
		
		let language = getFeedField(feedEntry, 'dc', 'language')
			|| getFeedField(feedEntry, null, 'language');
		if (language) item.language = language;
		
		/** Incorporate missing values from feed metadata **/
		
		let supplementFields = ['publicationTitle', 'ISSN', 'publisher', 'rights', 'language'];
		for (let i=0; i<supplementFields.length; i++) {
			let field = supplementFields[i];
			if (!item[field] && feedInfo[field]) {
				item[field] = feedInfo[field];
			}
		}
		
		guessItemType(item);
		
		return item;
	};
	
	let guessItemType = function(item) {
		item.itemType = 'journalArticle';
		
		if (item.ISSN) {
			return;
		}
		
		if (item.ISBN) {
			item.itemType = 'bookSection';
			return;
		}
		
		if (item.publicationType) {
			let type = item.publicationType.toLowerCase();
			if (type.indexOf('conference') != -1) {
				item.itemType = 'conferencePaper';
				return;
			}
			if (type.indexOf('journal') != -1) {
				item.itemType = 'journalArticle';
				return;
			}
			if (type.indexOf('book') != -1) {
				item.itemType = 'bookSection';
				return;
			}
		}
	};
	
	let processCreators = function(feedEntry, field, role) {
		let names;
		try {
			let personArr = feedEntry[field]; // Seems like this part can fail if there is no author data in the feed
			names = [];
			for (let i=0; i<personArr.length; i++) {
				let person = personArr.queryElementAt(i, Components.interfaces.nsIFeedPerson);
				if (!person || !person.name) continue;
				
				let name = Zotero.Utilities.trimInternal(person.name);
				if (!name) continue;
				
				let commas = name.split(',').length - 1,
						other = name.split(/\s(?:and|&)\s|;/).length - 1,
						separators = commas + other;
				if (personArr.length == 1 &&
					(other || commas > 1
					 || (commas == 1 && name.indexOf(' ', name.indexOf(',') + 2 /*Allow space after*/))
					)
				) {
					// Probably multiple authors listed in a single field
					names = name; // String, not array!
					break; // Should be implicit
				} else {
					names.push(name);
				}
			}
		} catch(e) {
			if (e.result != Components.results.NS_ERROR_FAILURE) throw e
			
			if (field != 'authors') return [];
			
			// ieeexplore places these in "authors"... sigh
			names = getFeedField(feedEntry, null, 'authors'); // String, not array!
			if (names) names = Zotero.Utilities.trimInternal(names);
			if (!names) return [];
		}
		
		if (typeof names == 'string') {
			names = names.split(/\s(?:and|&)\s|\s*[,;]\s*/);
		}
		
		let creators = [];
		for (let i=0; i<names.length; i++) {
			creators.push(
				Zotero.Utilities.cleanAuthor(
					names[i],
					role,
					names[i].split(',').length == 2
				)
			);
		}
		return creators;
	}
	
	this.getFeedProperties = function() {
		return feed.promise
			.then(getFeedInfo);
	};
	
	this.createItemIterator = function* () {
		// For the first item, we need to make sure that we wait for data
		yield feed.promise
			.then(() => {
				if (feedItems.length) {
					return feedItems[0];
				}
				return Zotero.Promise.resolve();
			});

		for (let i = 1; i < feedItems.length; i++) {
			yield feedItems[i];
		}
		return Zotero.Promise.resolve();
	};

	this.terminate = function(status) {
		Zotero.debug("FeedReader: Terminating feed reader (" + status + ")");
		
		if (feed.promise.isPending()) {
			feed.reject(status);
		}
		
		if (channel.isPending) {
			channel.cancel(Components.results.NS_BINDING_ABORTED);
		}
	};
	
	Zotero.debug("FeedReader: Fetching feed from " + feedUrl.spec);
	channel.asyncOpen(feedProcessor, null); // Sends an HTTP request
};