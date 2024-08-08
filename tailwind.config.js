module.exports = {
  content: [
    "./index.html",
    './src/**/*.{vue,js,ts,jsx,tsx}'
  ],
  corePlugins: {
    preflight: false
  },
  mode: 'jit',
  theme: {
    extend: {},
  },
  plugins: [],
}