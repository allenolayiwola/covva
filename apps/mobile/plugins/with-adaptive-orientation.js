const { withMainActivity, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const marker = '// Covva adaptive orientation';
const requiredChanges = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation'];

// Mirrors the native policy; use smallestScreenWidthDp, never current window width.
function orientationPolicy(smallestScreenWidthDp) {
  return smallestScreenWidthDp >= 600 ? 'FULL_USER' : 'PORTRAIT';
}

function transformMainActivity(source) {
  if (source.includes(marker)) return source;
  const create = /super\.onCreate\([^\n]*\);?/;
  if (!create.test(source)) throw new Error('Covva: MainActivity onCreate not found');
  let result = source.replace(create, '$&\n    applyCovvaOrientation()');
  if (/override fun onConfigurationChanged\(/.test(result)) {
    const changed = /super\.onConfigurationChanged\([^\n]*\);?/;
    if (!changed.test(result)) throw new Error('Covva: configuration callback super call not found');
    result = result.replace(changed, '$&\n    applyCovvaOrientation()');
  } else {
    result = result.replace(/\}\s*$/, `
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    applyCovvaOrientation()
  }
}
`);
  }
  return result.replace(/\}\s*$/, `
  ${marker}
  private fun applyCovvaOrientation() {
    val target = if (resources.configuration.smallestScreenWidthDp >= 600)
      android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER
    else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    if (requestedOrientation != target) requestedOrientation = target
  }
}
`);
}

function configureActivity(activity) {
  activity.$['android:resizeableActivity'] = 'true';
  const changes = new Set((activity.$['android:configChanges'] || '').split('|').filter(Boolean));
  requiredChanges.forEach(change => changes.add(change));
  activity.$['android:configChanges'] = [...changes].join('|');
  return activity;
}

module.exports = function withAdaptiveOrientation(config) {
  config = withAndroidManifest(config, mod => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    configureActivity(activity);
    return mod;
  });
  return withMainActivity(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Covva adaptive orientation requires Kotlin MainActivity');
    mod.modResults.contents = transformMainActivity(mod.modResults.contents);
    return mod;
  });
};
module.exports.transformMainActivity = transformMainActivity;
module.exports.configureActivity = configureActivity;
module.exports.orientationPolicy = orientationPolicy;
