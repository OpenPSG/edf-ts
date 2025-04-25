/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  testEnvironment: "node",
  transform: {
    "^.+\\.js$": "babel-jest",
    "^.+\\.tsx?$": ["ts-jest", {}],
  },
};
