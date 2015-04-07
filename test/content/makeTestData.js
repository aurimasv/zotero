if (ZoteroUnit.makeTestData) {
	Components.utils.import("resource://gre/modules/osfile.jsm");
	Components.utils.import("resource://gre/modules/AddonManager.jsm");
	
	AddonManager.getAddonByID("zotero-unit@zotero.org", function(addon) {
		var dataPath = addon.getResourceURI('tests/data')
			.QueryInterface(Components.interfaces.nsIFileURL).file.path;
		
		var oldPref = Zotero.Prefs.get("export.citePaperJournalArticleURL");
		Zotero.Prefs.set("export.citePaperJournalArticleURL", true);
		
		var dataFiles = ['allTypesAndFields', 'citeprocJSExport'];
		for (var i=0; i<dataFiles.length; i++) {
			if (i) ZoteroUnit.dump('\n');
			ZoteroUnit.dump('Generating data for ' + dataFiles[i] + '...');
			
			var data = window['generate' + dataFiles[i].charAt(0).toUpperCase() + dataFiles[i].substr(1) + 'Data']();
			var str = 'var data = ' + JSON.stringify(data, null, '\t');
			
			OS.File.writeAtomic(OS.Path.join(dataPath, dataFiles[i] + '.js'), str);
			
			ZoteroUnit.dump('done.');
		}
		
		Zotero.Prefs.set("export.citePaperJournalArticleURL", oldPref);
		
		quit(false);
	});
}