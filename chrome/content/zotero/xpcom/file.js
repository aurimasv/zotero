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

/**
 * Functions for reading files
 * @namespace
 */
Zotero.File = new function(){
	//Components.utils.import("resource://zotero/bluebird.js");
	Components.utils.import("resource://gre/modules/NetUtil.jsm");
	Components.utils.import("resource://gre/modules/FileUtils.jsm");
	
	this.getExtension = getExtension;
	this.getClosestDirectory = getClosestDirectory;
	this.getContentsFromURL = getContentsFromURL;
	this.putContents = putContents;
	this.getValidFileName = getValidFileName;
	this.truncateFileName = truncateFileName;
	this.getCharsetFromFile = getCharsetFromFile;
	this.addCharsetListener = addCharsetListener;
	
	
	this.pathToFile = function (pathOrFile) {
		if (typeof pathOrFile == 'string') {
			let nsIFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
			nsIFile.initWithPath(pathOrFile);
			return nsIFile;
		}
		else if (pathOrFile instanceof Ci.nsIFile) {
			return pathOrFile;
		}
		
		throw new Error('Unexpected value provided to Zotero.MIME.pathToFile() (' + pathOrFile + ')');
	}
	
	
	/**
	 * Encode special characters in file paths that might cause problems,
	 *  like # (but preserve slashes or colons)
	 *
	 * @param {String} path File path
	 * @return {String} Encoded file path
	 */
	this.encodeFilePath = function(path) {
		var parts = path.split(/([\\\/:]+)/);
		// Every other item is the separator
		for (var i=0, n=parts.length; i<n; i+=2) {
			parts[i] = encodeURIComponent(parts[i]);
		}
		return parts.join('');
	}
	
	function getExtension(file){
		var pos = file.leafName.lastIndexOf('.');
		return pos==-1 ? '' : file.leafName.substr(pos+1);
	}
	
	
	/*
	 * Traverses up the filesystem from a file until it finds an existing
	 *  directory, or false if it hits the root
	 */
	function getClosestDirectory(file) {
		var dir = file.parent;
		
		while (dir && !dir.exists()) {
			var dir = dir.parent;
		}
		
		if (dir && dir.exists()) {
			return dir;
		}
		return false;
	}
	
	
	/**
	 * Get the first 200 bytes of a source as a string (multibyte-safe)
	 *
	 * @param {nsIURI|nsIFile|string spec|nsIChannel|nsIInputStream} source - The source to read
	 * @return {Promise}
	 */
	this.getSample = function (file) {
		var bytes = 200;
		return this.getContentsAsync(file, null, bytes)
		.catch(function (e) {
			if (e.name == 'NS_ERROR_ILLEGAL_INPUT') {
				Zotero.debug("Falling back to raw bytes");
				return this.getBinaryContentsAsync(file, bytes);
			}
			throw e;
		}.bind(this));
	}
	
	
	/**
	 * Get contents of a binary file
	 */
	this.getBinaryContents = function(file) {
		var iStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
					 .createInstance(Components.interfaces.nsIFileInputStream);
		iStream.init(file, 0x01, 0664, 0);
		var bStream = Components.classes["@mozilla.org/binaryinputstream;1"]
					 .createInstance(Components.interfaces.nsIBinaryInputStream);
		bStream.setInputStream(iStream);
		var string = bStream.readBytes(file.fileSize);
		iStream.close();
		return string;
	}
	
	
	/**
	 * Get the contents of a file or input stream
	 * @param {nsIFile|nsIInputStream} file The file to read
	 * @param {String} [charset] The character set; defaults to UTF-8
	 * @param {Integer} [maxLength] The maximum number of bytes to read
	 * @return {String} The contents of the file
	 * @deprecated Use {@link Zotero.File.getContentsAsync} when possible
	 */
	this.getContents = function (file, charset, maxLength){
		var fis;
		if(file instanceof Components.interfaces.nsIInputStream) {
			fis = file;
		} else if(file instanceof Components.interfaces.nsIFile) {
			fis = Components.classes["@mozilla.org/network/file-input-stream;1"].
				createInstance(Components.interfaces.nsIFileInputStream);
			fis.init(file, 0x01, 0664, 0);
		} else {
			throw new Error("File is not an nsIInputStream or nsIFile");
		}
		
		charset = charset ? Zotero.CharacterSets.getName(charset) : "UTF-8";
		
		var blockSize = maxLength ? Math.min(maxLength, 524288) : 524288;
		
		const replacementChar
			= Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER;
		var is = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
			.createInstance(Components.interfaces.nsIConverterInputStream);
		is.init(fis, charset, blockSize, replacementChar);
		var chars = 0;
		
		var contents = "", str = {};
		while (is.readString(blockSize, str) !== 0) {
			if (maxLength) {
				var strLen = str.value.length;
				if ((chars + strLen) > maxLength) {
					var remainder = maxLength - chars;
					contents += str.value.slice(0, remainder);
					break;
				}
				chars += strLen;
			}
			
			contents += str.value;
		}
		
		is.close();
		
		return contents;
	};
	
	
	/**
	 * Get the contents of a text source asynchronously
	 *
	 * @param {nsIURI|nsIFile|string spec|string path|nsIChannel|nsIInputStream} source The source to read
	 * @param {String} [charset] The character set; defaults to UTF-8
	 * @param {Integer} [maxLength] Maximum length to fetch, in bytes
	 * @return {Promise} A promise that is resolved with the contents of the file
	 */
	this.getContentsAsync = function (source, charset, maxLength) {
		Zotero.debug("Getting contents of " + source);
		
		// If path is given, convert to file:// URL
		if (typeof source == 'string' && !source.match(/^file:/)) {
			source = 'file://' + source;
		}
		
		var options = {
			charset: charset ? Zotero.CharacterSets.getName(charset) : "UTF-8",
			// This doesn't seem to work -- reading an image file still throws NS_ERROR_ILLEGAL_INPUT
			replacement: "\uFFFD"
		};
		var deferred = Zotero.Promise.defer();
		NetUtil.asyncFetch(source, function(inputStream, status) {
			if (!Components.isSuccessCode(status)) {
				deferred.reject(new Components.Exception("File read operation failed", status));
				return;
			}
			
			try {
				var bytesToFetch = inputStream.available();
				if (maxLength && maxLength < bytesToFetch) {
					bytesToFetch = maxLength;
				}
				
				if (bytesToFetch == 0) {
					deferred.resolve("");
					return;
				}
				
				deferred.resolve(
					NetUtil.readInputStreamToString(
						inputStream,
						bytesToFetch,
						options
					)
				);
			}
			catch (e) {
				deferred.reject(e);
			}
		});
		return deferred.promise;
	};
	
	
	/**
	 * Get the contents of a binary source asynchronously
	 *
	 * @param {nsIURI|nsIFile|string spec|nsIChannel|nsIInputStream} source The source to read
	 * @param {Integer} [maxLength] Maximum length to fetch, in bytes (unimplemented)
	 * @return {Promise} A promise that is resolved with the contents of the source
	 */
	this.getBinaryContentsAsync = function (source, maxLength) {
		var deferred = Zotero.Promise.defer();
		NetUtil.asyncFetch(source, function(inputStream, status) {
			if (!Components.isSuccessCode(status)) {
				deferred.reject(new Components.Exception("Source read operation failed", status));
				return;
			}
			deferred.resolve(
				NetUtil.readInputStreamToString(
					inputStream,
					Math.min(maxLength, inputStream.available())
				)
			);
		});
		return deferred.promise;
	}
	
	
	/*
	 * Return the contents of a URL as a string
	 *
	 * Runs synchronously, so should only be run on local (e.g. chrome) URLs
	 */
	function getContentsFromURL(url) {
		var xmlhttp = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
						.createInstance();
		xmlhttp.open('GET', url, false);
		xmlhttp.overrideMimeType("text/plain");
		xmlhttp.send(null);
		return xmlhttp.responseText;
	}
	
	
	/*
	 * Return a promise for the contents of a URL as a string
	 */
	this.getContentsFromURLAsync = function (url) {
		return Zotero.HTTP.promise("GET", url, { responseType: "text" })
		.then(function (xmlhttp) {
			return xmlhttp.response;
		});
	}
	
	
	/*
	 * Write string to a file, overwriting existing file if necessary
	 */
	function putContents(file, str) {
		if (file.exists()) {
			file.remove(null);
		}
		var fos = Components.classes["@mozilla.org/network/file-output-stream;1"].
				createInstance(Components.interfaces.nsIFileOutputStream);
		fos.init(file, 0x02 | 0x08 | 0x20, 0664, 0);  // write, create, truncate
		
		var os = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
						   .createInstance(Components.interfaces.nsIConverterOutputStream);
		os.init(fos, "UTF-8", 4096, "?".charCodeAt(0));
		os.writeString(str);
		os.close();
		
		fos.close();
	}
	
	/**
	 * Write data to a file asynchronously
	 *
	 * @param {nsIFile} - The file to write to
	 * @param {String|nsIInputStream} data - The string or nsIInputStream to write to the file
	 * @param {String} [charset] - The character set; defaults to UTF-8
	 * @return {Promise} - A promise that is resolved when the file has been written
	 */
	this.putContentsAsync = function putContentsAsync(file, data, charset) {
		if (typeof data == 'string' && (!charset || charset.toLowerCase() == 'utf-8')) {
			let encoder = new TextEncoder();
			let array = encoder.encode(data);
			return Zotero.Promise.resolve(OS.File.writeAtomic(
				file.path,
				array,
				{
					tmpPath: OS.Path.join(Zotero.getTempDirectory().path, file.leafName + ".tmp")
				}
			))
			.catch(function (e) {
				Zotero.debug(e); // TEMP
				if (e instanceof OS.File.Error) {
					Zotero.debug(e);
					Zotero.debug(e.toString());
					throw new Error("Error for operation '" + e.operation + "' for " + file.path);
				}
				throw e;
			});
		}
		else {
			// Create a stream for async stream copying
			if(!(data instanceof Components.interfaces.nsIInputStream)) {
				var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
						createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
				converter.charset = charset ? Zotero.CharacterSets.getName(charset) : "UTF-8";
				data = converter.convertToInputStream(data);
			}
			
			var deferred = Zotero.Promise.defer(),
				ostream = FileUtils.openSafeFileOutputStream(file);
			NetUtil.asyncCopy(data, ostream, function(inputStream, status) {
				if (!Components.isSuccessCode(status)) {
					deferred.reject(new Components.Exception("File write operation failed", status));
					return;
				}
				deferred.resolve();
			});
			return deferred.promise;
		}
	};
	
	
	/**
	 * Delete a file if it exists, asynchronously
	 *
	 * @return {Promise<Boolean>} A Q promise for TRUE if file was deleted,
	 *                            FALSE if missing
	 */
	this.deleteIfExists = function deleteIfExists(path) {
		return Zotero.Promise.resolve(OS.File.remove(path))
		.thenResolve(true)
		.catch(function (e) {
			if (e instanceof OS.File.Error && e.becauseNoSuchFile) {
				return false;
			}
			throw e;
		});
	}
	
	
	/**
	 * Run a generator with an OS.File.DirectoryIterator, closing the
	 * iterator when done
	 *
	 * The DirectoryInterator is passed as the first parameter to the generator.
	 * A StopIteration error will be caught automatically.
	 *
	 * Zotero.File.iterateDirectory(path, function* (iterator) {
	 *    while (true) {
	 *        var entry = yield iterator.next();
	 *        [...]
	 *    }
	 * }).done()
	 *
	 * @return {Promise}
	 */
	this.iterateDirectory = function iterateDirectory(path, generator) {
		var iterator = new OS.File.DirectoryIterator(path);
		return Zotero.Promise.coroutine(generator)(iterator)
		.catch(function (e) {
			if (e != StopIteration) {
				throw e;
			}
		})
		.finally(function () {
			iterator.close();
		});
	}
	
	
	/**
	 * Generate a data: URI from an nsIFile
	 *
	 * From https://developer.mozilla.org/en-US/docs/data_URIs
	 */
	this.generateDataURI = function (file) {
		var contentType = Components.classes["@mozilla.org/mime;1"]
			.getService(Components.interfaces.nsIMIMEService)
			.getTypeFromFile(file);
		var inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
			.createInstance(Components.interfaces.nsIFileInputStream);
		inputStream.init(file, 0x01, 0600, 0);
		var stream = Components.classes["@mozilla.org/binaryinputstream;1"]
			.createInstance(Components.interfaces.nsIBinaryInputStream);
		stream.setInputStream(inputStream);
		var encoded = btoa(stream.readBytes(stream.available()));
		return "data:" + contentType + ";base64," + encoded;
	}
	
	
	this.copyToUnique = function (file, newFile) {
		newFile.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0644);
		var newName = newFile.leafName;
		newFile.remove(null);
		
		// Copy file to unique name
		file.copyTo(newFile.parent, newName);
		return newFile;
	}
	
	
	/**
	 * Copies all files from dir into newDir
	 */
	this.copyDirectory = function (dir, newDir) {
		if (!dir.exists()) {
			throw ("Directory doesn't exist in Zotero.File.copyDirectory()");
		}
		var otherFiles = dir.directoryEntries;
		while (otherFiles.hasMoreElements()) {
			var file = otherFiles.getNext();
			file.QueryInterface(Components.interfaces.nsIFile);
			file.copyTo(newDir, null);
		}
	}
	
	
	this.createDirectoryIfMissing = function (dir) {
		if (!dir.exists() || !dir.isDirectory()) {
			if (dir.exists() && !dir.isDirectory()) {
				dir.remove(null);
			}
			dir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);
		}
	}
	
	
	/**
	 * Check whether a directory is an ancestor directory of another directory/file
	 */
	this.directoryContains = function (dir, file) {
		if (!dir.isDirectory()) {
			throw new Error("dir must be a directory");
		}
		
		if (dir.exists()) {
			dir.normalize();
		}
		if (file.exists()) {
			file.normalize();
		}
		
		if (!dir.path) {
			throw new Error("dir.path is empty");
		}
		if (!file.path) {
			throw new Error("file.path is empty");
		}
		
		return file.path.indexOf(dir.path) == 0;
	}
	
	
	/**
	 * Strip potentially invalid characters
	 *
	 * See http://en.wikipedia.org/wiki/Filename#Reserved_characters_and_words
	 *
	 * @param	{String}	fileName
	 * @param	{Boolean}	[skipXML=false]		Don't strip characters invalid in XML
	 */
	function getValidFileName(fileName, skipXML) {
		// TODO: use space instead, and figure out what's doing extra
		// URL encode when saving attachments that trigger this
		fileName = fileName.replace(/[\/\\\?\*:|"<>]/g, '');
		// Replace newlines and tabs (which shouldn't be in the string in the first place) with spaces
		fileName = fileName.replace(/[\r\n\t]+/g, ' ');
		// Replace various thin spaces
		fileName = fileName.replace(/[\u2000-\u200A]/g, ' ');
		// Replace zero-width spaces
		fileName = fileName.replace(/[\u200B-\u200E]/g, '');
		if (!skipXML) {
			// Strip characters not valid in XML, since they won't sync and they're probably unwanted
			fileName = fileName.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/g, '');
		}
		// Don't allow blank or illegal filenames
		if (!fileName || fileName == '.' || fileName == '..') {
			fileName = '_';
		}
		return fileName;
	}
	
	/**
	 * Truncate a filename (excluding the extension) to the given total length
	 * If the "extension" is longer than 20 characters,
	 * it is treated as part of the file name
	 */
	function truncateFileName(fileName, maxLength) {
		if(!fileName || (fileName + '').length <= maxLength) return fileName;

		var parts = (fileName + '').split(/\.(?=[^\.]+$)/);
		var fn = parts[0];
		var ext = parts[1];
		//if the file starts with a period , use the whole file
		//the whole file name might also just be a period
		if(!fn) {
			fn = '.' + (ext || '');
		}

		//treat long extensions as part of the file name
		if(ext && ext.length > 20) {
			fn += '.' + ext;
			ext = undefined;
		}

		if(ext === undefined) {	//there was no period in the whole file name
			ext = '';
		} else {
			ext = '.' + ext;
		}

		return fn.substr(0,maxLength-ext.length) + ext;
	}
	
	/*
	 * Not implemented, but it'd sure be great if it were
	 */
	function getCharsetFromByteArray(arr) {
		
	}
	
	
	/*
	 * An extraordinarily inelegant way of getting the character set of a
	 * text file using a hidden browser
	 *
	 * I'm quite sure there's a better way
	 *
	 * Note: This is for text files -- don't run on other files
	 *
	 * 'callback' is the function to pass the charset (and, if provided, 'args')
	 * to after detection is complete
	 */
	function getCharsetFromFile(file, mimeType, callback, args){
		if (!file || !file.exists()){
			callback(false, args);
			return;
		}
		
		if (mimeType.substr(0, 5) != 'text/' ||
				!Zotero.MIME.hasInternalHandler(mimeType, this.getExtension(file))) {
			callback(false, args);
			return;
		}
		
		var browser = Zotero.Browser.createHiddenBrowser();
		
		var url = Components.classes["@mozilla.org/network/protocol;1?name=file"]
				.getService(Components.interfaces.nsIFileProtocolHandler)
				.getURLSpecFromFile(file);
		
		this.addCharsetListener(browser, function (charset, args) {
			callback(charset, args);
			Zotero.Browser.deleteHiddenBrowser(browser);
		}, args);
		
		browser.loadURI(url);
	}
	
	
	/*
	 * Attach a load listener to a browser object to perform charset detection
	 *
	 * We make sure the universal character set detector is set to the
	 * universal_charset_detector (temporarily changing it if not--shhhh)
	 *
	 * 'callback' is the function to pass the charset (and, if provided, 'args')
	 * to after detection is complete
	 */
	function addCharsetListener(browser, callback, args){
		var prefService = Components.classes["@mozilla.org/preferences-service;1"]
							.getService(Components.interfaces.nsIPrefBranch);
		var oldPref = prefService.getCharPref('intl.charset.detector');
		var newPref = 'universal_charset_detector';
		//Zotero.debug("Default character detector is " + (oldPref ? oldPref : '(none)'));
		
		if (oldPref != newPref){
			//Zotero.debug('Setting character detector to universal_charset_detector');
			prefService.setCharPref('intl.charset.detector', 'universal_charset_detector');
		}
		
		var onpageshow = function(){
			// ignore spurious about:blank loads
			if(browser.contentDocument.location.href == "about:blank") return;

			browser.removeEventListener("pageshow", onpageshow, false);
			
			var charset = browser.contentDocument.characterSet;
			Zotero.debug("Detected character set '" + charset + "'");
			
			//Zotero.debug('Resetting character detector to ' + (oldPref ? oldPref : '(none)'));
			prefService.setCharPref('intl.charset.detector', oldPref);
			
			callback(charset, args);
		};
		
		browser.addEventListener("pageshow", onpageshow, false);
	}
	
	
	this.checkFileAccessError = function (e, file, operation) {
		if (file) {
			var str = Zotero.getString('file.accessError.theFile', file.path);
		}
		else {
			var str = Zotero.getString('file.accessError.aFile');
		}
		
		switch (operation) {
			case 'create':
				var opWord = Zotero.getString('file.accessError.created');
				break;
				
			case 'update':
				var opWord = Zotero.getString('file.accessError.updated');
				break;
				
			case 'delete':
				var opWord = Zotero.getString('file.accessError.deleted');
				break;
				
			default:
				var opWord = Zotero.getString('file.accessError.updated');
		}
		
		if (e.name == 'NS_ERROR_FILE_ACCESS_DENIED' || e.name == 'NS_ERROR_FILE_IS_LOCKED'
				// These show up on some Windows systems
				|| e.name == 'NS_ERROR_FAILURE' || e.name == 'NS_ERROR_FILE_NOT_FOUND') {
			Zotero.debug(e);
			str = str + " " + Zotero.getString('file.accessError.cannotBe') + " " + opWord + ".";
			var checkFileWindows = Zotero.getString('file.accessError.message.windows');
			var checkFileOther = Zotero.getString('file.accessError.message.other');
			var msg = str + "\n\n"
					+ (Zotero.isWin ? checkFileWindows : checkFileOther)
					+ "\n\n"
					+ Zotero.getString('file.accessError.restart');
			
			var e = new Zotero.Error(
				msg,
				0,
				{
					dialogButtonText: Zotero.getString('file.accessError.showParentDir'),
					dialogButtonCallback: function () {
						try {
							file.parent.QueryInterface(Components.interfaces.nsILocalFile);
							file.parent.reveal();
						}
						// Unsupported on some platforms
						catch (e2) {
							Zotero.launchFile(file.parent);
						}
					}
				}
			);
		}
		
		throw (e);
	}
}
