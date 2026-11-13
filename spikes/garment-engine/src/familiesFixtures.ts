/**
 * Text-only fixtures for src/families.test.ts, copied from bohohippychic.com.au's public
 * /products.json on 2026-11-06 (fields the family rules read, HTML attributes stripped; image URLs and sizes, no image bytes):
 * 14 colours of the Earthweave Knit Top (the copy varies: "Singlet is not included", "Camis" vs
 * "camis", straight vs curly apostrophes, "Colour:" lines), the Earthweave Knit Top Navy whose copy
 * was rewritten (a near miss), the seven Bohemian Wanderer Patchwork Pants PWP1-PWP7, and guards
 * against false merges: a maxi and a midi dress with one print name, and a blouse and pants with one
 * print name (Rosewater).
 */
import type { ShopifyProduct } from './shop';

export const FAMILY_FIXTURES: {
  earthweave: ShopifyProduct[];
  earthweaveNavy: ShopifyProduct;
  pwp: ShopifyProduct[];
  guards: ShopifyProduct[];
} = {
 "earthweave": [
  {
   "id": 10894459502897,
   "title": "Earthweave Knit Top Steel Grey",
   "handle": "earthweave-knit-top-steel-grey",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Steel Grey </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Steel Grey",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024051872049,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746888053041,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Steel-Grey-1.jpg?v=1792556264",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746888085809,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Steel-Grey.jpg?v=1792556264",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894461108529,
   "title": "Earthweave Knit Top Black",
   "handle": "earthweave-knit-top-black",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p>Singlet is not included.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Black </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "black",
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024114032945,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746899521841,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Black-2.jpg?v=1792556393",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916807409969,
   "title": "Earthweave Knit Top Coral",
   "handle": "earthweave-knit-top-coral",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p> Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over Camis, tee’s, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Coral</strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "coral",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219460202801,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60884929478961,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Coral.jpg?v=1793374721",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916806885681,
   "title": "Earthweave Knit Top Denim Blue",
   "handle": "earthweave-knit-top-denim-blue",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p> Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee’s, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Denim Blue </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "blue",
    "Clothing",
    "Collections",
    "denim",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219454665009,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60884927676721,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP4-2_d4d060f0-c0de-4424-a895-94c3b3327f5e.jpg?v=1793374707",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894441972017,
   "title": "Earthweave Knit Top Meadow Green",
   "handle": "earthweave-knit-top-meadow-green",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Meadow Green </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "Meadow Green",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57023547146545,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746752491825,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Meadow-Green.jpg?v=1792555364",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894460879153,
   "title": "Earthweave Knit Top Raspberry",
   "handle": "earthweave-knit-top-raspberry",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over Camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p>Singlet is not included.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Raspberry </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "raspberry",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024102039857,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746896998705,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Magneta-2.jpg?v=1792556353",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894460125489,
   "title": "Earthweave Knit Top Royal Blue",
   "handle": "earthweave-knit-top-royal-blue",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over Camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Royal Blue </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Royal Blue",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024059310385,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746891002161,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Royal-Blue-2.jpg?v=1792556293",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894459011377,
   "title": "Earthweave Knit Top Aqua",
   "handle": "earthweave-knit-top-aqua",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Aqua </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "aqua",
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024038666545,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746883662129,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Aqua.jpg?v=1792556241",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894460944689,
   "title": "Earthweave Knit Top Chocolate",
   "handle": "earthweave-knit-top-chocolate",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p>Singlet is not included.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Chocolate </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "chocolate",
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024103219505,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746897785137,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Chocolate.jpg?v=1792556368",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894460256561,
   "title": "Earthweave Knit Top Cornflower Blue",
   "handle": "earthweave-knit-top-cornflower-blue",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Cornflower Blue </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Cornflower Blue",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024060227889,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746891624753,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Cornflower-Blue-2.jpg?v=1792556301",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916807213361,
   "title": "Earthweave Knit Top Dark Grey",
   "handle": "earthweave-knit-top-dark-grey",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p> Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over Camis, tee’s, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Dark Grey </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tangarine",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219456500017,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60884928758065,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Dark-Grey.jpg?v=1793374716",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894460813617,
   "title": "Earthweave Knit Top Deep Purple",
   "handle": "earthweave-knit-top-deep-purple",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p>Singlet is not included.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Deep Purple </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Deep Purple",
    "Earthweave Top",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024094961969,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746895720753,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/dark_purple_boho_top_800x1200_f071561e-a0a4-4717-adce-0f1be7858b05.jpg?v=1792556345",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894459339057,
   "title": "Earthweave Knit Top Gucci Green",
   "handle": "earthweave-knit-top-gucci-green",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Gucci Green </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Gucci Green",
    "Just Landed",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024047579441,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746887266609,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Gucci-Green.jpg?v=1792556256",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894460911921,
   "title": "Earthweave Knit Top Khaki",
   "handle": "earthweave-knit-top-khaki",
   "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p>Singlet is not included.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p><strong>Colour : Khaki </strong></p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Collections",
    "Earthweave Top",
    "Just Landed",
    "khaki",
    "Layering Top",
    "New",
    "Poncho Top",
    "Tops"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57024103186737,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "49.00"
    }
   ],
   "images": [
    {
     "id": 60746897391921,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Khaki.jpg?v=1792556360",
     "width": 800,
     "height": 1200
    }
   ]
  }
 ],
 "earthweaveNavy": {
  "id": 10894409302321,
  "title": "Earthweave Knit Top Navy",
  "handle": "earthweave-knit-top-navy",
  "body_html": "<p>The Earthweave Knit Top is an effortless layering piece designed for free-spirited style and all-day comfort. With its relaxed, boxy silhouette and wide sleeves, it offers a breezy, laid-back fit that flatters sizes AU 8 through to AU 18.</p>\n<p>Crafted in a deep navy, this open-knit design adds texture and warmth without feeling heavy. Its free-size shape makes it a versatile staple — perfect for layering over Camis, tee's, skirts &amp; dresses for that relaxed boho vibe.</p>\n<p><strong>Features:</strong></p>\n<p>Fits sizes AU 8–18</p>\n<p>Length from Shoulder 53cm</p>\n<p>Chest Laid Flat Front: 63cm (cir) 126cm </p>\n<p>Lightweight open-knit design</p>\n<p>Wide, relaxed sleeves for comfort</p>\n<p>Free-size, boxy silhouette</p>\n<p>Navy</p>\n<p>Material Rayon</p>\n<p>We make every effort to present our product colours as accurately as possible. Please note that slight colour variations may occur due to individual monitor settings, screen brightness, and device displays.</p>",
  "vendor": "Boho Hippy Chic",
  "product_type": "Tops",
  "tags": [
   "Clothing",
   "Collections",
   "Earthweave Top",
   "Layering Top",
   "navy",
   "Poncho Top",
   "Tops"
  ],
  "options": [
   {
    "name": "Title",
    "values": [
     "Default Title"
    ]
   }
  ],
  "variants": [
   {
    "id": 57022830838065,
    "title": "Default Title",
    "option1": "Default Title",
    "price": "49.00"
   }
  ],
  "images": [
   {
    "id": 60746529636657,
    "position": 1,
    "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Navy-Top-2.jpg?v=1792553929",
    "width": 800,
    "height": 1200
   }
  ]
 },
 "pwp": [
  {
   "id": 10916806263089,
   "title": "Bohemian Wanderer Patchwork Pants PWP1",
   "handle": "bohemian-wanderer-patchwork-pants-pwp1",
   "body_html": "<p>Make a statement in our Bohemian Wanderer Patchwork Pants — a colourful, free-spirited style made for the true boho lover.</p>\n<p>Each pair is completely one of a kind, created from a beautiful mix of patchwork prints and colours. No two pairs are the same, making every pair uniquely yours.</p>\n<p>Designed with an easy-flowing wide leg and a comfortable wide elastic waistband, these pants are relaxed, floaty and effortless to wear. Finished with handy side pockets for everyday practicality.</p>\n<p>As an extra little boho touch, every pair comes with its own FREE matching patchwork  bag. Because of the one-of-a-kind fabrics, your bag will also vary in colour and print.</p>\n<p><strong>Details</strong></p>\n<p>Free Size</p>\n<p>Wide elastic waistband</p>\n<p>Waist measures approx. <strong>28cm–46cm across the front</strong> (unstretched to stretched)</p>\n<p>Free Size 8-16</p>\n<p>Relaxed wide-leg design</p>\n<p>Side pockets</p>\n<p>One-of-a-kind patchwork design</p>\n<p><strong>What you see here is what you get.</strong></p>\n<p>Includes a <strong>FREE patchwork bag</strong></p>\n<p><strong>Every pair is different — that’s what makes them special.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Bohemian Wanderer Patchwork Pants",
    "Clothing",
    "Collections",
    "Pants",
    "PWP1"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219450077489,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60884925514033,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP1-2.jpg?v=1793374695",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60884925546801,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP1-B.jpg?v=1793374695",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916805837105,
   "title": "Bohemian Wanderer Patchwork Pants PWP2",
   "handle": "bohemian-wanderer-patchwork-pants-pwp2",
   "body_html": "<p>Make a statement in our Bohemian Wanderer Patchwork Pants — a colourful, free-spirited style made for the true boho lover.</p>\n<p>Each pair is completely one of a kind, created from a beautiful mix of patchwork prints and colours. No two pairs are the same, making every pair uniquely yours.</p>\n<p>Designed with an easy-flowing wide leg and a comfortable wide elastic waistband, these pants are relaxed, floaty and effortless to wear. Finished with handy side pockets for everyday practicality.</p>\n<p>As an extra little boho touch, every pair comes with its own FREE matching patchwork  bag. Because of the one-of-a-kind fabrics, your bag will also vary in colour and print.</p>\n<p><strong>Details</strong></p>\n<p>Free Size</p>\n<p>Wide elastic waistband</p>\n<p>Waist measures approx. <strong>28cm–46cm across the front</strong> (unstretched to stretched)</p>\n<p>Free Size 8-16</p>\n<p>Relaxed wide-leg design</p>\n<p>Side pockets</p>\n<p>One-of-a-kind patchwork design</p>\n<p><strong>What you see here is what you get.</strong></p>\n<p>Includes a <strong>FREE patchwork bag</strong></p>\n<p><strong>Every pair is different — that’s what makes them special.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Bohemian Wanderer Patchwork Pants",
    "Clothing",
    "Collections",
    "Pants",
    "PWP2"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219448275249,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60884924170545,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP2-2.jpg?v=1793374684",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60884924203313,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP2-B.jpg?v=1793374684",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916805869873,
   "title": "Bohemian Wanderer Patchwork Pants PWP3",
   "handle": "bohemian-wanderer-patchwork-pants-pwp3",
   "body_html": "<p>Make a statement in our Bohemian Wanderer Patchwork Pants — a colourful, free-spirited style made for the true boho lover.</p>\n<p>Each pair is completely one of a kind, created from a beautiful mix of patchwork prints and colours. No two pairs are the same, making every pair uniquely yours.</p>\n<p>Designed with an easy-flowing wide leg and a comfortable wide elastic waistband, these pants are relaxed, floaty and effortless to wear. Finished with handy side pockets for everyday practicality.</p>\n<p>As an extra little boho touch, every pair comes with its own FREE matching patchwork  bag. Because of the one-of-a-kind fabrics, your bag will also vary in colour and print.</p>\n<p><strong>Details</strong></p>\n<p>Free Size</p>\n<p>Wide elastic waistband</p>\n<p>Waist measures approx. <strong>28cm–46cm across the front</strong> (unstretched to stretched)</p>\n<p>Free Size 8-16</p>\n<p>Relaxed wide-leg design</p>\n<p>Side pockets</p>\n<p>One-of-a-kind patchwork design</p>\n<p><strong>What you see here is what you get.</strong></p>\n<p>Includes a <strong>FREE patchwork bag</strong></p>\n<p><strong>Every pair is different — that’s what makes them special.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Bohemian Wanderer Patchwork Pants",
    "Clothing",
    "Collections",
    "Pants",
    "PWP3"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219448308017,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60884924465457,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP3.jpg?v=1793374685",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60884924498225,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP3B-2.jpg?v=1793374685",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916806197553,
   "title": "Bohemian Wanderer Patchwork Pants PWP4",
   "handle": "bohemian-wanderer-patchwork-pants-pwp4",
   "body_html": "<p>Make a statement in our Bohemian Wanderer Patchwork Pants — a colourful, free-spirited style made for the true boho lover.</p>\n<p>Each pair is completely one of a kind, created from a beautiful mix of patchwork prints and colours. No two pairs are the same, making every pair uniquely yours.</p>\n<p>Designed with an easy-flowing wide leg and a comfortable wide elastic waistband, these pants are relaxed, floaty and effortless to wear. Finished with handy side pockets for everyday practicality.</p>\n<p>As an extra little boho touch, every pair comes with its own FREE matching patchwork  bag. Because of the one-of-a-kind fabrics, your bag will also vary in colour and print.</p>\n<p><strong>Details</strong></p>\n<p>Free Size</p>\n<p>Wide elastic waistband</p>\n<p>Waist measures approx. <strong>28cm–46cm across the front</strong> (unstretched to stretched)</p>\n<p>Free Size 8-16</p>\n<p>Relaxed wide-leg design</p>\n<p>Side pockets</p>\n<p>One-of-a-kind patchwork design</p>\n<p><strong>What you see here is what you get.</strong></p>\n<p>Includes a <strong>FREE patchwork bag</strong></p>\n<p><strong>Every pair is different — that’s what makes them special.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Bohemian Wanderer Patchwork Pants",
    "Clothing",
    "Collections",
    "Pants",
    "PWP4"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219449848113,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60884925219121,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP4-2.jpg?v=1793374694",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916805935409,
   "title": "Bohemian Wanderer Patchwork Pants PWP5",
   "handle": "bohemian-wanderer-patchwork-pants-pwp5",
   "body_html": "<p>Make a statement in our Bohemian Wanderer Patchwork Pants — a colourful, free-spirited style made for the true boho lover.</p>\n<p>Each pair is completely one of a kind, created from a beautiful mix of patchwork prints and colours. No two pairs are the same, making every pair uniquely yours.</p>\n<p>Designed with an easy-flowing wide leg and a comfortable wide elastic waistband, these pants are relaxed, floaty and effortless to wear. Finished with handy side pockets for everyday practicality.</p>\n<p>As an extra little boho touch, every pair comes with its own FREE matching patchwork  bag. Because of the one-of-a-kind fabrics, your bag will also vary in colour and print.</p>\n<p><strong>Details</strong></p>\n<p>Free Size</p>\n<p>Wide elastic waistband</p>\n<p>Waist measures approx. <strong>28cm–46cm across the front</strong> (unstretched to stretched)</p>\n<p>Free Size 8-16</p>\n<p>Relaxed wide-leg design</p>\n<p>Side pockets</p>\n<p>One-of-a-kind patchwork design</p>\n<p><strong>What you see here is what you get.</strong></p>\n<p>Includes a <strong>FREE patchwork bag</strong></p>\n<p><strong>Every pair is different — that’s what makes them special.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Bohemian Wanderer Patchwork Pants",
    "Clothing",
    "Collections",
    "Pants",
    "PWP5"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219448537393,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60884924629297,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP5-2.jpg?v=1793374687",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916806033713,
   "title": "Bohemian Wanderer Patchwork Pants PWP6",
   "handle": "bohemian-wanderer-patchwork-pants-pwp6",
   "body_html": "<p>Make a statement in our Bohemian Wanderer Patchwork Pants — a colourful, free-spirited style made for the true boho lover.</p>\n<p>Each pair is completely one of a kind, created from a beautiful mix of patchwork prints and colours. No two pairs are the same, making every pair uniquely yours.</p>\n<p>Designed with an easy-flowing wide leg and a comfortable wide elastic waistband, these pants are relaxed, floaty and effortless to wear. Finished with handy side pockets for everyday practicality.</p>\n<p>As an extra little boho touch, every pair comes with its own FREE matching patchwork  bag. Because of the one-of-a-kind fabrics, your bag will also vary in colour and print.</p>\n<p><strong>Details</strong></p>\n<p>Free Size</p>\n<p>Wide elastic waistband</p>\n<p>Waist measures approx. <strong>28cm–46cm across the front</strong> (unstretched to stretched)</p>\n<p>Free Size 8-16</p>\n<p>Relaxed wide-leg design</p>\n<p>Side pockets</p>\n<p>One-of-a-kind patchwork design</p>\n<p><strong>What you see here is what you get.</strong></p>\n<p>Includes a <strong>FREE patchwork bag</strong></p>\n<p><strong>Every pair is different — that’s what makes them special.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Bohemian Wanderer Patchwork Pants",
    "Clothing",
    "Collections",
    "Pants",
    "PWP6"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219448963377,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60884924825905,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP6-2.jpg?v=1793374689",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60884924858673,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP6-B.jpg?v=1793374689",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916806132017,
   "title": "Bohemian Wanderer Patchwork Pants PWP7",
   "handle": "bohemian-wanderer-patchwork-pants-pwp7",
   "body_html": "<p>Make a statement in our Bohemian Wanderer Patchwork Pants — a colourful, free-spirited style made for the true boho lover.</p>\n<p>Each pair is completely one of a kind, created from a beautiful mix of patchwork prints and colours. No two pairs are the same, making every pair uniquely yours.</p>\n<p>Designed with an easy-flowing wide leg and a comfortable wide elastic waistband, these pants are relaxed, floaty and effortless to wear. Finished with handy side pockets for everyday practicality.</p>\n<p>As an extra little boho touch, every pair comes with its own FREE matching patchwork  bag. Because of the one-of-a-kind fabrics, your bag will also vary in colour and print.</p>\n<p><strong>Details</strong></p>\n<p>Free Size</p>\n<p>Wide elastic waistband</p>\n<p>Waist measures approx. <strong>28cm–46cm across the front</strong> (unstretched to stretched)</p>\n<p>Free Size 8-16</p>\n<p>Relaxed wide-leg design</p>\n<p>Side pockets</p>\n<p>One-of-a-kind patchwork design</p>\n<p><strong>What you see here is what you get.</strong></p>\n<p>Includes a <strong>FREE patchwork bag</strong></p>\n<p><strong>Every pair is different — that’s what makes them special.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Bohemian Wanderer Patchwork Pants",
    "Clothing",
    "Collections",
    "Pants",
    "PWP7"
   ],
   "options": [
    {
     "name": "Title",
     "values": [
      "Default Title"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219449618737,
     "title": "Default Title",
     "option1": "Default Title",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60884924989745,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP7-2.jpg?v=1793374691",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60884925022513,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/PWP7-B.jpg?v=1793374691",
     "width": 800,
     "height": 1200
    }
   ]
  }
 ],
 "guards": [
  {
   "id": 10931376587057,
   "title": "Summer Romance Floral Maxi Dress  Ivory",
   "handle": "summer-romance-floral-maxi-dress-ivory",
   "body_html": "<p><span>Fall in love with our beautiful </span><strong><span>Summer Romance Floral Maxi Dress</span></strong><span>, a dreamy blend of effortless elegance and free-spirited bohemian charm.</span></p>\n<p><span>Featuring a gorgeous watercolour-inspired floral print in soft coral, pink and earthy olive tones against a delicate ivory background, this stunning maxi dress is made for those beautiful summer days.</span></p>\n<p><span>The flattering square neckline and delicate adjustable shoulder straps create a feminine look, while the softly gathered bodice and elasticated waist offer a comfortable, relaxed fit.</span></p>\n<p><span>The gorgeous flowing maxi-length skirt moves beautifully with every step, creating an effortlessly romantic silhouette.</span></p>\n<p><span>Perfect for summer holidays, beachside lunches, garden parties or sunset dinners, this beautiful dress is one you'll reach for again and again.</span></p>\n<h3><span>Features</span></h3>\n<p><span>Beautiful ivory base with romantic floral print</span></p>\n<p><span>Soft coral, pink and olive green tones</span></p>\n<p><span>Flattering square neckline</span></p>\n<p><span>Delicate adjustable shoulder straps</span></p>\n<p><span>Softly gathered, relaxed bodice</span></p>\n<p><span>Comfortable elasticated waist</span></p>\n<p><span>Flowing maxi-length skirt</span></p>\n<p><span>Feminine, relaxed bohemian style</span></p>\n<p><span>Perfect for summer and holidays</span></p>\n<p>A little floral romance, a touch of bohemian beauty and effortless summer style.</p>",
   "vendor": "Boho Hippy Chic ",
   "product_type": "Dresses",
   "tags": [
    "Boho Maxi Dress",
    "Clothing",
    "Collections",
    "New",
    "Summer Romance Floral Maxi Dress Ivory"
   ],
   "options": [
    {
     "name": "Size",
     "values": [
      "8",
      "10",
      "12",
      "14",
      "16"
     ]
    }
   ],
   "variants": [
    {
     "id": 57301580841265,
     "title": "8",
     "option1": "8",
     "price": "99.00"
    },
    {
     "id": 57301580874033,
     "title": "10",
     "option1": "10",
     "price": "99.00"
    },
    {
     "id": 57301580906801,
     "title": "12",
     "option1": "12",
     "price": "99.00"
    },
    {
     "id": 57301580939569,
     "title": "14",
     "option1": "14",
     "price": "99.00"
    },
    {
     "id": 57301580972337,
     "title": "16",
     "option1": "16",
     "price": "99.00"
    }
   ],
   "images": [
    {
     "id": 60952539005233,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/LG0302_1.jpg?v=1793778979",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60952525537585,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/LG03022.jpg?v=1793778907",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10916808032561,
   "title": "Summer Romance Floral Midi Dress",
   "handle": "summer-romance-floral-midi-dress",
   "body_html": "<p>Fall in love with our gorgeous <strong>Summer Romance Floral Midi Dress</strong>, a dreamy blend of feminine charm and effortless bohemian style.</p>\n<p>Featuring a beautiful mix of soft pastel florals in shades of pink, peach, orange and lavender, this romantic dress is perfect for those who love a little colour in their wardrobe.</p>\n<p>Designed with a flattering V-neckline, delicate lace trim and pretty button-down front, this dress is full of gorgeous details. The softly defined waist creates a feminine silhouette, while the flowing tiered skirt and flutter sleeves add beautiful movement and an effortlessly relaxed feel.</p>\n<p>Perfect for weekend lunches, garden parties, holidays or simply enjoying a beautiful summer day.</p>\n<p>Pair it with your favourite sandals and boho accessories for an easy, feminine look.</p>\n<p><strong>Key Features</strong></p>\n<ul>\n<li>Beautiful multicoloured pastel floral print</li>\n<li>Flattering V-neckline with delicate lace trim</li>\n<li>Pretty button-down front</li>\n<li>Soft flutter sleeves</li>\n<li>Defined waist for a flattering shape</li>\n<li>Flowing tiered midi-length skirt</li>\n<li>Delicate lace trim detailing</li>\n<li>Romantic, feminine boho style</li>\n<li>Rayon Blend</li>\n<li>Available in sizes 8 to 16</li>\n</ul>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Dresses",
   "tags": [
    "Clothing",
    "Collections",
    "Dress",
    "Dresses",
    "Floral",
    "Just Landed",
    "Midi",
    "New",
    "Summer Romance"
   ],
   "options": [
    {
     "name": "Size",
     "values": [
      "8",
      "10",
      "12",
      "14",
      "16"
     ]
    }
   ],
   "variants": [
    {
     "id": 57219464495409,
     "title": "8",
     "option1": "8",
     "price": "89.00"
    },
    {
     "id": 57219464528177,
     "title": "10",
     "option1": "10",
     "price": "89.00"
    },
    {
     "id": 57219464560945,
     "title": "12",
     "option1": "12",
     "price": "89.00"
    },
    {
     "id": 57219464593713,
     "title": "14",
     "option1": "14",
     "price": "89.00"
    },
    {
     "id": 57219464626481,
     "title": "16",
     "option1": "16",
     "price": "89.00"
    }
   ],
   "images": [
    {
     "id": 60884932198705,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/YF0030-1.jpg?v=1793374735",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60884932231473,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/YF0030-2.jpg?v=1793374735",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894374666545,
   "title": "Rosewater Blouse",
   "handle": "rosewater-blouse",
   "body_html": "<p><strong>🌸 Rosewater Bloom Blouse 🌸</strong></p><p>Softly feminine and effortlessly chic, the <strong>Rosewater Bloom Blouse</strong> features a delicate floral print in rose, peach and cream tones on a powder-blue base. Designed with a button-down front, gentle gathering at the shoulders, and airy half sleeves finished with elastic cuffs — this blouse brings a touch of boho romance to any outfit.</p><p>Crafted from <strong>100% lightweight rayon</strong>, it drapes beautifully and feels soft against the skin. Pair it with denim for a relaxed everyday look or with the matching <strong>Rosewater Bloom Palazzo Pants</strong> for a dreamy boho set.</p><p><strong>Available in Australian sizes 8–16.</strong></p>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Tops",
   "tags": [
    "Clothing",
    "Rosewater Blouse",
    "Tops"
   ],
   "options": [
    {
     "name": "Size",
     "values": [
      "8",
      "10",
      "12",
      "14",
      "16"
     ]
    }
   ],
   "variants": [
    {
     "id": 57021781082417,
     "title": "8",
     "option1": "8",
     "price": "69.00"
    },
    {
     "id": 57021781115185,
     "title": "10",
     "option1": "10",
     "price": "69.00"
    },
    {
     "id": 57021781147953,
     "title": "12",
     "option1": "12",
     "price": "69.00"
    },
    {
     "id": 57021781180721,
     "title": "14",
     "option1": "14",
     "price": "69.00"
    },
    {
     "id": 57021781213489,
     "title": "16",
     "option1": "16",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60746983801137,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T073909.516.jpg?v=1792557677",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983735601,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T073937.773.jpg?v=1792557678",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983768369,
     "position": 3,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T073958.645.jpg?v=1792557678",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983833905,
     "position": 4,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T074018.098.jpg?v=1792557678",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983866673,
     "position": 5,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T072138.591_1c9c4ad1-16b9-45cd-a83b-ee2f7f13b2ed.jpg?v=1792557677",
     "width": 800,
     "height": 1200
    }
   ]
  },
  {
   "id": 10894374568241,
   "title": "Rosewater Palazzo Pants",
   "handle": "rosewater-palazzo-pants",
   "body_html": "<p>Effortlessly elegant and beautifully relaxed, the <strong>Rosewater Bloom Palazzo Pants</strong> feature the same dreamy floral print as the matching maxi dress — soft rose, peach, and cream tones on a powder-blue base.</p><p>Crafted from <strong>100% lightweight rayon</strong>, these wide-leg pants offer a breezy, free-flowing silhouette with a comfortable <strong>elastic drawstring waist</strong> and practical side pockets. Perfect for pairing with the matching blouse or the Luna Cami for an easy boho-luxe look.</p><p><strong>Available in Australian sizes 8–16.</strong></p><h2><strong>Palazzo Pants Size Chart</strong></h2><div><div><table>\n<thead><tr>\n<th>Measurement (cm)</th>\n<th>AU 8</th>\n<th>AU 10</th>\n<th>AU 12</th>\n<th>AU 14</th>\n<th>AU 16</th>\n</tr></thead>\n<tbody>\n<tr>\n<td><strong>Waist</strong></td>\n<td>94</td>\n<td>110</td>\n<td>112</td>\n<td>118</td>\n<td>124</td>\n</tr>\n<tr>\n<td><strong>Hips</strong></td>\n<td>110</td>\n<td>112</td>\n<td>118</td>\n<td>122</td>\n<td>130</td>\n</tr>\n<tr>\n<td><strong>Length</strong></td>\n<td>97</td>\n<td>98</td>\n<td>99</td>\n<td>100</td>\n<td>101</td>\n</tr>\n</tbody>\n</table></div></div>",
   "vendor": "Boho Hippy Chic",
   "product_type": "Pants",
   "tags": [
    "Clothing",
    "Pants",
    "Rosewater Palazzo Pants"
   ],
   "options": [
    {
     "name": "Size",
     "values": [
      "8",
      "10",
      "12",
      "14",
      "16"
     ]
    }
   ],
   "variants": [
    {
     "id": 57021776822577,
     "title": "8",
     "option1": "8",
     "price": "69.00"
    },
    {
     "id": 57021776855345,
     "title": "10",
     "option1": "10",
     "price": "69.00"
    },
    {
     "id": 57021776888113,
     "title": "12",
     "option1": "12",
     "price": "69.00"
    },
    {
     "id": 57021776920881,
     "title": "14",
     "option1": "14",
     "price": "69.00"
    },
    {
     "id": 57021776953649,
     "title": "16",
     "option1": "16",
     "price": "69.00"
    }
   ],
   "images": [
    {
     "id": 60746983538993,
     "position": 1,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Rose-Water-Mila.jpg?v=1792557673",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983571761,
     "position": 2,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T072201.709.jpg?v=1792557673",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983506225,
     "position": 3,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T072254.881.jpg?v=1792557673",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983637297,
     "position": 4,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T072229.454.jpg?v=1792557673",
     "width": 800,
     "height": 1200
    },
    {
     "id": 60746983604529,
     "position": 5,
     "src": "https://cdn.shopify.com/s/files/1/0982/2620/9073/files/Untitled-design-2025-11-15T072138.591.jpg?v=1792557673",
     "width": 800,
     "height": 1200
    }
   ]
  }
 ]
};
