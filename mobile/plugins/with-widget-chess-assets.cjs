const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const PIECES = ['bb', 'bk', 'bn', 'bp', 'bq', 'br', 'wb', 'wk', 'wn', 'wp', 'wq', 'wr'];
const CATALOG = 'ChessPieces.xcassets';

module.exports = function withWidgetChessAssets(config) {
  config = withDangerousMod(config, ['ios', async (mod) => {
    const catalog = path.join(mod.modRequest.platformProjectRoot, 'ExpoWidgetsTarget', CATALOG);
    await fs.mkdir(catalog, { recursive: true });
    await fs.writeFile(path.join(catalog, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2));

    for (const piece of PIECES) {
      const imageSet = path.join(catalog, `${piece}.imageset`);
      await fs.mkdir(imageSet, { recursive: true });
      await fs.copyFile(
        path.join(mod.modRequest.projectRoot, 'assets', 'chess-pieces', `${piece}.png`),
        path.join(imageSet, `${piece}.png`),
      );
      await fs.writeFile(path.join(imageSet, 'Contents.json'), JSON.stringify({
        images: [
          { filename: `${piece}.png`, idiom: 'universal', scale: '1x' },
          { idiom: 'universal', scale: '2x' },
          { idiom: 'universal', scale: '3x' },
        ],
        info: { author: 'xcode', version: 1 },
      }, null, 2));
    }
    return mod;
  }]);

  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = project.findTargetKey('ExpoWidgetsTarget');
    if (!target) throw new Error('ExpoWidgetsTarget was not created before chess assets were configured');
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'Resources');
    const nativeTarget = project.pbxNativeTargetSection()[target];
    const resourcePhases = project.hash.project.objects.PBXResourcesBuildPhase ?? {};
    const hasResourcePhase = nativeTarget.buildPhases.some(({ value }) => resourcePhases[value]);
    if (!hasResourcePhase) {
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target);
    }
    if (!project.hasFile(`ExpoWidgetsTarget/${CATALOG}`)) {
      project.addResourceFile(`ExpoWidgetsTarget/${CATALOG}`, { target });
    }
    return mod;
  });
};
