export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['controllers/**/*.js', 'routes/**/*.js', 'app.js'],
  clearMocks: true
};
