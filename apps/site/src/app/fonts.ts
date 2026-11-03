import { Inter, Outfit } from "next/font/google";

// Variable Outfit: Light (300) for headings, Bold (700) for the home hero headline.
export const outfit = Outfit({ subsets: ["latin"], display: "swap", variable: "--font-outfit" });
// Inter supplies body/UI text and the extended Latin letters used in Ghanaian languages.
export const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });
