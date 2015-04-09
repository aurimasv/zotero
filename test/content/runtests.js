Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.import("resource://zotero/q.js");
var EventUtils = Components.utils.import("resource://zotero-unit/EventUtils.jsm");

var ZoteroUnit = Components.classes["@mozilla.org/commandlinehandler/general-startup;1?type=zotero-unit"].
                 getService(Components.interfaces.nsISupports).
                 wrappedJSObject;

var dump = ZoteroUnit.dump;

function quit(failed) {
	// Quit with exit status
	if(!failed) {
		OS.File.writeAtomic(OS.Path.join(OS.Constants.Path.profileDir, "success"), new Uint8Array(0));
	}
	if(!ZoteroUnit.noquit) {
		Components.classes['@mozilla.org/toolkit/app-startup;1'].
		getService(Components.interfaces.nsIAppStartup).
		quit(Components.interfaces.nsIAppStartup.eForceQuit);
	}
}

if (ZoteroUnit.makeTestData) {
	let dataPath = getTestDataDirectory().path;
	
	Zotero.Prefs.set("export.citePaperJournalArticleURL", true);
	
	let dataFiles = ['allTypesAndFields', 'citeProcJSExport'];
	let p = Q.resolve();
	for (let i=0; i<dataFiles.length; i++) {
		let first = !i;
		let fileName = dataFiles[i];
		
		p = p.then(function() {
			// Make sure to not run next loop if previous fails
			return Q.try(function() {
				if (!first) dump('\n');
				dump('Generating data for ' + fileName + '...');
				
				let data = window['generate' + fileName.charAt(0).toUpperCase() + fileName.substr(1) + 'Data']();
				let str = 'var data = ' + JSON.stringify(data, null, '\t');
				
				return OS.File.writeAtomic(OS.Path.join(dataPath, fileName + '.js'), str);
			})
			.then(function() { dump("done."); })
			.catch(function(e) { dump("failed!"); throw e })
		});
	}
	
	p.catch(function(e) { dump('\n'); dump(e) })
	.finally(function() { quit(false) });
}

function Reporter(runner) {
	var indents = 0, passed = 0, failed = 0;

	function indent() {
		return Array(indents).join('  ');
	}

	runner.on('start', function(){});

	runner.on('suite', function(suite){
		++indents;
		dump(indent()+suite.title+"\n");
	});

	runner.on('suite end', function(suite){
		--indents;
		if (1 == indents) dump("\n");
	});

	runner.on('pending', function(test){
		dump(indent()+"pending  -"+test.title);
	});

	runner.on('pass', function(test){
		passed++;
		var msg = "\r"+indent()+Mocha.reporters.Base.symbols.ok+" "+test.title;
		if ('fast' != test.speed) {
			msg += " ("+Math.round(test.duration)+" ms)";
		}
		dump(msg+"\n");
	});

	runner.on('fail', function(test, err){
		failed++;
		dump("\r"+indent()+Mocha.reporters.Base.symbols.err+" "+test.title+"\n"+
		     indent()+"  "+err.toString()+" at\n"+
		     indent()+"    "+err.stack.replace("\n", "\n"+indent()+"    ", "g"));
	});

	runner.on('end', function() {
		dump(passed+"/"+(passed+failed)+" tests passed.\n");
		quit(failed != 0);
	});
}

// Setup Mocha
mocha.setup({ui:"bdd", reporter:Reporter});
var assert = chai.assert,
    expect = chai.expect;

// Set up tests to run
var run = ZoteroUnit.runTests;
if(run && ZoteroUnit.tests) {
	var testDirectory = getTestDataDirectory().parent,
	    testFiles = [];
	if(ZoteroUnit.tests == "all") {
		var enumerator = testDirectory.directoryEntries;
		while(enumerator.hasMoreElements()) {
			var file = enumerator.getNext().QueryInterface(Components.interfaces.nsIFile);
			if(file.leafName.endsWith(".js")) {
				testFiles.push(file.leafName);
			}
		}
	} else {
		var specifiedTests = ZoteroUnit.tests.split(",");
		for(var test of specifiedTests) {
			var fname = test+".js",
			    file = testDirectory.clone();
			file.append(fname);
			if(!file.exists()) {
				dump("Invalid test file "+test+"\n");
				run = false;
				quit(true);
			}
			testFiles.push(fname);
		}
	}

	for(var fname of testFiles) {
		var el = document.createElement("script");
		el.type = "application/javascript;version=1.8";
		el.src = "resource://zotero-unit-tests/"+fname;
		document.body.appendChild(el);
	}
}

if(run) {
	window.onload = function() {
		Zotero.Schema.schemaUpdatePromise.then(function() {
			mocha.run();
		}).done();
	};
}