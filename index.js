var path = require('path');
var fs = require('fs');
var semver = require('semver');


/**
 * This does the peer-requiring work.
 *
 * @param {Object}  deps      A hash-map of all known peer-dependencies.
 * @param {Module}  baseMod   The module from where we require.
 * @param {string}  name      The name of the peer dependency to require.
 * @param {Object}  [options] Options.
 * @param {boolean} [options.optional] Return undefined if the dependency could not be found.
 * @param {boolean} [options.dontThrow] Suppresses all possible errors.
 * @return {Object}           The required module's exports object.
 */

function realRequire(deps, baseMod, name, options) {
	var range = deps[name];
	var mod;

	if (options.dontThrow || options.optional) {
		try {
			mod = baseMod.require(name);
		} catch (error) {
			// ignore error
			return;
		}
	} else {
		mod = baseMod.require(name);
	}

	if (!range) {
		// no restriction
		return mod;
	}

	var pkgPath = path.join(name, 'package.json');

	var pkg = baseMod.require(pkgPath);
	if (!pkg.version) {
		if (options.dontThrow) {
			return;
		}

		throw new Error('Package "' + name + '" has no version information in ' + pkgPath);
	}

	if (typeof pkg.version !== 'string') {
		if (options.dontThrow) {
			return;
		}

		throw new TypeError('Version in package "' + name + '" is not a string.');
	}

	if (!semver.satisfies(pkg.version, range)) {
		if (options.dontThrow) {
			return;
		}

		throw new Error(
			'Package "' + name + '" of version ' + pkg.version +
			' does not satisfy requirement: ' + range
		);
	}

	return mod;
}


/**
 * Scans the disk for a package.json file. The given module's location and its
 * parent directories are scanned until their package.json file is found, or
 * until the file system's root folder is reached.
 *
 * @param {Module} baseModule The module for which to find a package file.
 * @return {Object}           The parsed package.json file.
 */

exports.findPackage = function (baseModule) {
	var lastDir = baseModule.filename;
	var pkgPath;

	do {
 		var dir = path.dirname(lastDir);

		if (!dir || dir === lastDir) {
			throw new Error('No package.json found');
		}

		pkgPath = path.join(dir, 'package.json');

		lastDir = dir;
	} while (!fs.existsSync(pkgPath));

	// make sure that the package.json we found really is the one we need

	if (require(path.dirname(pkgPath)) !== baseModule.exports) {
		throw new Error('No package.json found that resolves to ' + baseModule.filename + ' (found instead: ' + path.dirname(pkgPath) + ')');
	}

	// read package.json

	return require(pkgPath);
};


/**
 * Extracts all dependencies and their versions from a parsed package.json
 * definition.
 *
 * @param {Object} pkg       The parsed package.json contents.
 * @param {string} [entries] The list of properties to scan.
 * @return {Object}          A dependency-name/version-range hash map.
 */

exports.extractDeps = function (pkg, entries) {
	var fullDeps = {};

	for (var i = 0; i < entries.length; i++) {
		var deps = pkg[entries[i]];

		if (!deps) {
			continue;
		}

		var names = Object.keys(deps);
		for (var j = 0; j < names.length; j++) {
			var name = names[j];
			var range = deps[name];

			var sanitised = semver.validRange(range);
			if (!sanitised) {
				throw new Error(
					'Version range ' + range + ' of dependency "' + name + '" is not a valid range.'
				);
			}

			fullDeps[name] = sanitised;
		}
	}

	return fullDeps;
};


/**
 * Creates an peerRequire function based on the package.json requirements for
 * the given middleware module.
 *
 * @param {Module} baseModule          The module that hosts the optionalPeerDependencies.
 * @param {Object} [options]           Options object
 * @param {string[]} [options.entries] Which package entries to evaluate. Defaults to ["optionalPeerDependencies"].
 * @return {OptPeerDeps}
 */

exports.create = function (baseModule, options) {
	options = options || {};

	// find the nearest package.json

	var pkg = exports.findPackage(baseModule);

	// create a dependency list

	var deps = exports.extractDeps(pkg, options.entries || ['optionalPeerDependencies']);

	// change the baseModule to its own parent, as that's where we'll be requiring peers from

	baseModule = baseModule.parent;

	// create and return a peerRequire function

	return function peerRequire(name, options) {
		return realRequire(deps, baseModule, name, options || {});
	};
};

