export default {
  extends: ['@commitlint/config-conventional'],
  plugins: ['commitlint-plugin-rai'],
  rules: {
    'rai-footer-exists': [2, 'always'],
    'rai-signed-off-by': [2, 'always'],
  },
};
