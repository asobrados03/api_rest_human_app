export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  collectCoverageFrom: ['controllers/**/*.js', 'routes/**/*.js', 'app.js'],
  clearMocks: true
};
