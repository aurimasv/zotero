if (ZoteroUnit.makeTestData) {
	var dataPath = getTestDataDirectory().path;
	
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
}