/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/app/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Baloo 2", "system-ui", "sans-serif"],
        body: ["Nunito", "system-ui", "sans-serif"],
      },
      colors: {
        category: {
          exercise: "#FF6B6B",
          nutrition: "#FFA94D",
          sleep: "#5C7CFA",
          mindfulness: "#845EF7",
          home: "#20C997",
          money: "#94D82D",
          relationships: "#F783AC",
          work: "#339AF0",
          learning: "#FAB005",
          digital: "#495057",
          outdoors: "#40C057",
          selfcare: "#E64980",
        },
      },
    },
  },
  plugins: [],
};
