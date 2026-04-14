const fs = require("fs");
const path = require("path");
const ResEdit = require('resedit');

function windowsPostBuild(output, icon) {
    const exe = ResEdit.NtExecutable.from(fs.readFileSync(output));
    const res = ResEdit.NtExecutableResource.from(exe);
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icon));
    const jsonObj = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json')));
    const versionString = jsonObj.version;
    const versionParts = versionString.split('.'); 
    const major = parseInt(versionParts[0], 10);
    const minor = parseInt(versionParts[1], 10);
    const patch = parseInt(versionParts[2], 10);
    process.stdout.write(`angel-lsp version: ${major}.${minor}.${patch}\n`);

    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        1,
        1033,
        iconFile.icons.map(item => item.data)
    );

    const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];

    vi.setStringValues(
        {lang: 1033, codepage: 1200},
        {
            ProductName: 'AngelScript Language Server',
            FileDescription: 'AngelScript Language Server for VSCode and other clients',
            CompanyName: '',
            LegalCopyright: `MIT License`
        }
    );
    vi.removeStringValue({lang: 1033, codepage: 1200}, 'OriginalFilename');
    vi.removeStringValue({lang: 1033, codepage: 1200}, 'InternalName');
    vi.setFileVersion(major, minor, patch);
    vi.setProductVersion(major, minor, patch);
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(output, Buffer.from(exe.generate()));
    process.stdout.write(`Attach metadata to angel-lsp successfully\n`);
}

function resolveBaseDir() {
    const basedirArg = process.argv.find(a => a.startsWith('--basedir='));
    if (basedirArg) {
        return path.resolve(basedirArg.split('=')[1]);
    }

    return __dirname;
}

if (require.main === module) {
    const baseDir = resolveBaseDir();
    const exePath = path.join(baseDir, 'angelscript-ls.exe');
    const iconPath = path.join(__dirname, 'icon.ico');

    if (!fs.existsSync(exePath)) {
        console.error(`Error: executable not found at ${exePath}`);
        process.exit(2);
    }
    if (!fs.existsSync(iconPath)) {
        console.error(`Error: icon not found at ${iconPath}`);
        process.exit(3);
    }

    windowsPostBuild(exePath, iconPath);
}
