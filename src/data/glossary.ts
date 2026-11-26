export interface GlossaryLink {
  kind: 'article' | 'video';
  labelId: string;
  labelEn: string;
  href: string;
}

export interface GlossaryEntry {
  id: string;
  termId: string;
  termEn: string;
  shortId?: string;
  shortEn?: string;
  descId: string;
  descEn: string;
  links: GlossaryLink[];
}

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  {
    id: 'mdpl',
    termId: 'mdpl',
    termEn: 'mdpl (m asl)',
    shortId: 'Meter di Atas Permukaan Laut',
    shortEn: 'Meters above mean sea level',
    descId:
      'Satuan ketinggian permukaan tanah yang diukur dari permukaan laut rata-rata. Di Nagari Balingka, ketinggian berkisar dari 1.032 mdpl di area lembah hingga 2.869 mdpl di lereng atas Gunung Singgalang.',
    descEn:
      'Ground elevation measured above mean sea level. Across Nagari Balingka, elevation ranges from 1,032 m in valley settlements up to 2,869 m on the upper slopes of Mount Singgalang.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca di Wikipedia',
        labelEn: 'Read on Wikipedia',
        href: 'https://id.wikipedia.org/wiki/Meter_di_atas_permukaan_laut'
      }
    ]
  },
  {
    id: 'demnas',
    termId: 'DEM / BIG DEMNAS',
    termEn: 'DEM / BIG DEMNAS',
    shortId: 'Digital Elevation Model Nasional (~8,3 m)',
    shortEn: 'National Digital Elevation Model (~8.3 m)',
    descId:
      'Peta ketinggian tanah digital resmi dari Badan Informasi Geospasial (BIG) dengan resolusi sekitar 8,3 meter per piksel. Menjadi dasar perhitungan lereng, kontur, bukit 3D, dan arah aliran topografi.',
    descEn:
      'Official national digital terrain height grid published by Badan Informasi Geospasial (BIG) at ~8.3 m spatial resolution. Powers 3D terrain, slope gradients, contours, and flow routing.',
    links: [
      {
        kind: 'article',
        labelId: 'Portal BIG Tanahair',
        labelEn: 'BIG Tanahair Portal',
        href: 'https://tanahair.indonesia.go.id'
      },
      {
        kind: 'video',
        labelId: 'Video penjelasan DEMNAS',
        labelEn: 'DEMNAS video explainers',
        href: 'https://www.youtube.com/results?search_query=apa+itu+DEM+DEMNAS+BIG'
      }
    ]
  },
  {
    id: 'contour',
    termId: 'Garis Kontur (25 m)',
    termEn: 'Contour Lines (25 m)',
    shortId: 'Garis penghubung titik sama tinggi',
    shortEn: 'Lines joining equal elevation',
    descId:
      'Garis imajiner pada peta yang menghubungkan titik-titik berketinggian sama setiap kelipatan 25 meter. Garis yang berdekatan rapat menandakan tebing/lereng terjal; garis yang renggang menandakan dataran lebih landai.',
    descEn:
      'Map lines connecting points of equal elevation at 25 m intervals. Closely spaced contours indicate steep slopes or cliffs; wider spacing indicates gentler valley floors.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca tentang Garis Kontur',
        labelEn: 'Read about Contour Lines',
        href: 'https://id.wikipedia.org/wiki/Garis_kontur'
      },
      {
        kind: 'video',
        labelId: 'Video cara baca kontur',
        labelEn: 'How to read contours',
        href: 'https://www.youtube.com/results?search_query=cara+membaca+garis+kontur+peta+topografi'
      }
    ]
  },
  {
    id: 'hillshade',
    termId: 'Bayangan Bukit & Lembah (Hillshade)',
    termEn: 'Hillshade',
    shortId: 'Pencahayaan relief topografi 2D & 3D',
    shortEn: 'Shaded terrain relief',
    descId:
      'Efek pencahayaan bayangan buatan dari ketinggian DEM untuk menonjolkan punggungan bukit, ngarai, dan lekukan lembah sehingga bentuk permukaan bumi lebih mudah dibaca pada peta 2D maupun 3D.',
    descEn:
      'Simulated directional sunlight shading derived from DEM elevation so ridges, valleys, and gullies stand out visually on both 2D and 3D maps.',
    links: [
      {
        kind: 'article',
        labelId: 'Penjelasan Terrain Shading',
        labelEn: 'Terrain Shading on Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Terrain_cartography#Shaded_relief'
      },
      {
        kind: 'video',
        labelId: 'Video penjelasan Hillshade',
        labelEn: 'Hillshade GIS video',
        href: 'https://www.youtube.com/results?search_query=hillshade+GIS+explained'
      }
    ]
  },
  {
    id: 'slope',
    termId: 'Kemiringan Lereng (%)',
    termEn: 'Slope Gradient (%)',
    shortId: 'Rasio naik/turun per 100 m datar',
    shortEn: 'Vertical rise per 100 m run',
    descId:
      'Mengukur seberapa curam tanah dalam persen (contoh: lereng 25% berarti turun 25 m setiap jarak datar 100 m). Pada peta Lereng, area >15% disorot untuk menunjukkan kemiringan sedang hingga terjal (>38%).',
    descEn:
      'Measures terrain steepness as a percentage (e.g., 25% equals 25 m vertical change per 100 m horizontal distance). Areas >15% and steep-slope points (>38%) highlight progressively steeper hillsides.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca tentang Kemiringan',
        labelEn: 'Slope grade on Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Grade_(slope)'
      },
      {
        kind: 'video',
        labelId: 'Video hitung kemiringan (%)',
        labelEn: 'Slope percentage video',
        href: 'https://www.youtube.com/results?search_query=cara+menghitung+kemiringan+lereng+persen'
      }
    ]
  },
  {
    id: 'vertical-exag',
    termId: 'Skala Tinggi Bukit 3D (Vertical Exaggeration)',
    termEn: '3D Relief Height (Vertical Exag.)',
    shortId: 'Pengali skala visual ketinggian 1,0×–2,2×',
    shortEn: 'Visual height multiplier 1.0×–2.2×',
    descId:
      'Pengali tampilan tinggi bukit pada mode 3D agar perbedaan lereng dan cekungan terlihat lebih jelas. Pengaturan ini murni visual dan tidak mengubah angka ketinggian (mdpl) ataupun perhitungan aliran.',
    descEn:
      'Visual vertical multiplier applied to the 3D terrain mesh so ridges and valleys are easier to distinguish. Purely visual — actual mdpl values and hydrological calculations remain unchanged.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca Vertical Exaggeration',
        labelEn: 'Vertical exaggeration on Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Vertical_exaggeration'
      }
    ]
  },
  {
    id: 'hand',
    termId: 'HAND',
    termEn: 'HAND',
    shortId: 'Height Above Nearest Drainage',
    shortEn: 'Height Above Nearest Drainage',
    descId:
      'Indeks topografi yang mengukur tinggi suatu lokasi relatif terhadap dasar alur sungai terdekat yang mengalirinya. Area biru muda (cekungan dangkal) dan biru tua (>1,5 m HAND) menandai lekukan lembah tempat air topografi berkumpul pada model.',
    descEn:
      'Topographic index measuring how high each grid cell sits above the nearest drainage channel flowing from it. Light blue (shallow) and deep blue (>1.5 m HAND) highlight low-lying valley corridors in the model.',
    links: [
      {
        kind: 'article',
        labelId: 'Referensi metode HAND (Wikipedia)',
        labelEn: 'HAND method reference',
        href: 'https://en.wikipedia.org/wiki/Topographic_wetness_index'
      },
      {
        kind: 'video',
        labelId: 'Video konsep model HAND',
        labelEn: 'HAND flood model videos',
        href: 'https://www.youtube.com/results?search_query=Height+Above+Nearest+Drainage+HAND+flood+model'
      }
    ]
  },
  {
    id: 'd8',
    termId: 'D8 (Penelusuran Arah Aliran)',
    termEn: 'D8 (Flow Direction)',
    shortId: 'Algoritma Deterministic-8 dari DEMNAS',
    shortEn: 'Deterministic-8 elevation routing',
    descId:
      'Algoritma hidrologi yang menentukan ke mana air mengalir di setiap kotak grid dengan memilih 1 dari 8 tetangga yang paling curam ke bawah. Digunakan untuk menggambar garis putus-putus jingga arah kemiringan dan menghitung waktu tempuh gelombang air.',
    descEn:
      'Hydrological routing algorithm that sends runoff from each DEM cell into the steepest downhill neighbor among its 8 surrounding cells. Drives the dashed amber flow lines and D8 travel-time estimates.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca Flow Routing (Wikipedia)',
        labelEn: 'Hydrological modeling on Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Hydrological_modeling'
      },
      {
        kind: 'video',
        labelId: 'Video algoritma D8 Flow Direction',
        labelEn: 'D8 flow direction explained',
        href: 'https://www.youtube.com/results?search_query=D8+flow+direction+algorithm+hydrology'
      }
    ]
  },
  {
    id: 'scs-cn',
    termId: 'SCS-CN (Limpasan Permukaan)',
    termEn: 'SCS-CN (Surface Runoff)',
    shortId: 'Soil Conservation Service Curve Number',
    shortEn: 'Soil Conservation Service Curve Number',
    descId:
      'Rumus hidrologi standar untuk memperkirakan berapa banyak air hujan yang menjadi aliran permukaan vs meresap ke tanah, berdasarkan tutupan lahan (hutan, sawah, terbangun) dan kelembapan awal tanah (kering, lembap, jenuh).',
    descEn:
      'Standard hydrological formula estimating how much rainfall becomes surface runoff versus infiltrating into soil, driven by land cover (forest, cropland, built-up) and antecedent soil moisture (dry, moist, saturated).',
    links: [
      {
        kind: 'article',
        labelId: 'Baca Runoff Curve Number',
        labelEn: 'Runoff Curve Number on Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Runoff_curve_number'
      },
      {
        kind: 'video',
        labelId: 'Video penjelasan SCS Curve Number',
        labelEn: 'SCS Curve Number explained',
        href: 'https://www.youtube.com/results?search_query=SCS+Curve+Number+runoff+method+explained'
      }
    ]
  },
  {
    id: 'hydrograph',
    termId: 'Hidrograf & Debit Aliran (Q)',
    termEn: 'Hydrograph & Discharge (Q)',
    shortId: 'Grafik perubahan volume aliran sungai dari waktu ke waktu (m³/s)',
    shortEn: 'Streamflow volume curve over time (m³/s)',
    descId:
      'Grafik yang menyandingkan curah hujan dari waktu ke waktu (batang biru atas) dengan perkiraan laju volume air di saluran utama Q dalam meter kubik per detik (garis biru). Kurva menunjukkan waktu naik menuju puncak, fase surut setelah hujan berhenti, serta rentang ketidakpastian P10–P90 karena model belum terkalibrasi alat ukur sungai (AWLR).',
    descEn:
      'A chart pairing rainfall input over time (top blue bars) with estimated main-channel flow rate Q in cubic meters per second (blue curve). Shows rising lag to peak flow, post-storm recession drain, and P10–P90 uncertainty spread because the model is not yet calibrated against a physical river gauge.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca tentang Hidrograf (Wikipedia)',
        labelEn: 'Hydrograph on Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Hydrograph'
      },
      {
        kind: 'video',
        labelId: 'Video cara membaca Hidrograf',
        labelEn: 'How to read a hydrograph',
        href: 'https://www.youtube.com/results?search_query=what+is+a+hydrograph+explained'
      }
    ]
  },
  {
    id: 'rain-intensity',
    termId: 'Intensitas Hujan (mm/jam)',
    termEn: 'Rainfall Intensity (mm/hr)',
    shortId: 'Ketebalan air hujan dalam 1 jam',
    shortEn: 'Rain depth falling in 1 hour',
    descId:
      'Ukuran kelebatan hujan jika seluruh air tertampung di bidang datar tanpa meresap selama 1 jam (1 mm = 1 liter air per m²). Acuan BMKG: Ringan (<20), Sedang (20–50), Lebat (50–100), dan Ekstrem (>100 mm/jam).',
    descEn:
      'Rate of rainfall depth over one hour on a flat surface (1 mm equals 1 liter per m²). BMKG reference bands: Light (<20), Moderate (20–50), Heavy (50–100), and Extreme (>100 mm/hr).',
    links: [
      {
        kind: 'article',
        labelId: 'Portal Resmi BMKG',
        labelEn: 'Official BMKG Portal',
        href: 'https://www.bmkg.go.id'
      },
      {
        kind: 'video',
        labelId: 'Video arti curah hujan mm/jam',
        labelEn: 'Rainfall intensity mm/hr video',
        href: 'https://www.youtube.com/results?search_query=arti+curah+hujan+mm+per+jam+BMKG'
      }
    ]
  },
  {
    id: 'stream-burning',
    termId: 'Sisipkan ke DEM (Stream Burning)',
    termEn: 'Stream Burning',
    shortId: 'Menyisipkan jalur sungai nyata ke data elevasi DEM',
    shortEn: 'Carving verified channels into DEM',
    descId:
      'Teknik menyisipkan alur sungai yang sudah dipetakan atau diverifikasi di lapangan ke dalam salinan data elevasi DEM (dalam literatur GIS dikenal sebagai Stream Burning). Tujuannya agar jalur perhitungan tidak melenceng akibat tajuk pohon atau atap bangunan sehingga aliran tetap mengikuti sungai nyata.',
    descEn:
      'Technique that lowers DEM elevation slightly along verified real-world river lines inside a working copy so computed D8 drainage paths follow actual channels rather than artifacts from tree canopy or roofs.',
    links: [
      {
        kind: 'video',
        labelId: 'Video penjelasan Stream Burning DEM',
        labelEn: 'DEM stream burning explained',
        href: 'https://www.youtube.com/results?search_query=DEM+stream+burning+hydrology'
      }
    ]
  },
  {
    id: 'manning-omega',
    termId: 'Rumus Manning & Energi Arus (ω)',
    termEn: 'Manning Formula & Stream Power (ω)',
    shortId: 'Kapasitas penuh saluran (bankfull) & W/m²',
    shortEn: 'Bankfull channel capacity & W/m²',
    descId:
      'Rumus hidrolika untuk memperkirakan debit maksimal saat kapasitas saluran penuh (bankfull, rumus Manning) serta kekuatan arus per meter lebar saluran (Specific Stream Power, ω dalam Watt/m²). Nilai ω ≥ 300 dan ≥ 1000 W/m² lazim dipakai dalam literatur erosi tebing.',
    descEn:
      'Open-channel hydraulics equations estimating bankfull discharge (Manning) and flow energy per unit width (Specific Stream Power ω in W/m²). Thresholds ω ≥ 300 and ≥ 1000 W/m² are standard hydraulic energy benchmarks.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca Rumus Manning (Wikipedia)',
        labelEn: 'Manning formula on Wikipedia',
        href: 'https://en.wikipedia.org/wiki/Manning_formula'
      },
      {
        kind: 'video',
        labelId: 'Video penjelasan Rumus Manning',
        labelEn: 'Manning equation video',
        href: 'https://www.youtube.com/results?search_query=Manning+equation+open+channel+flow+explained'
      }
    ]
  },
  {
    id: 'das-hulu-hilir',
    termId: 'DAS, Hulu & Hilir',
    termEn: 'Watershed (DAS), Upstream & Downstream',
    shortId: 'Daerah Aliran Sungai',
    shortEn: 'Drainage basin & flow direction',
    descId:
      'DAS (Daerah Aliran Sungai) adalah bentang alam tempat air hujan berkumpul menuju sistem sungai yang sama. Hulu adalah bagian atas di lereng gunung tempat aliran berawal; hilir adalah bagian lebih rendah tempat air keluar menuju lembah atau muara.',
    descEn:
      'A watershed (DAS) is the land area draining rainfall into a shared river network. Upstream (hulu) refers to higher mountain slopes where runoff starts; downstream (hilir) refers to lower valley reaches where flows converge.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca tentang DAS di Wikipedia',
        labelEn: 'Drainage basin on Wikipedia',
        href: 'https://id.wikipedia.org/wiki/Daerah_aliran_sungai'
      },
      {
        kind: 'video',
        labelId: 'Video pengertian DAS hulu–hilir',
        labelEn: 'Watershed basics video',
        href: 'https://www.youtube.com/results?search_query=pengertian+DAS+hulu+hilir'
      }
    ]
  },
  {
    id: 'rbi-50k',
    termId: 'BIG RBI 1:50.000',
    termEn: 'BIG RBI 1:50,000',
    shortId: 'Peta Rupa Bumi Indonesia',
    shortEn: 'Indonesian Topographic Base Map',
    descId:
      'Peta dasar topografi resmi Indonesia terbitan Badan Informasi Geospasial (edisi Kab. Agam Des 2022). Menyediakan jaringan sungai & anak sungai (322 ruas di area Balingka), jembatan, gorong-gorong, serta lokasi fasilitas umum.',
    descEn:
      'Official Indonesian topographic base map published by BIG (Kab. Agam Dec 2022 edition). Provides 322 river/tributary reaches, bridges, culverts, and public facilities across the Balingka area.',
    links: [
      {
        kind: 'article',
        labelId: 'Portal Geospasial BIG',
        labelEn: 'BIG Geospatial Portal',
        href: 'https://tanahair.indonesia.go.id'
      },
      {
        kind: 'video',
        labelId: 'Video tentang Peta RBI BIG',
        labelEn: 'About BIG RBI maps',
        href: 'https://www.youtube.com/results?search_query=peta+RBI+BIG+Indonesia'
      }
    ]
  },
  {
    id: 'worldcover',
    termId: 'ESA WorldCover (10 m)',
    termEn: 'ESA WorldCover (10 m)',
    shortId: 'Peta tutupan lahan global 10 meter',
    shortEn: 'Global 10 m land-cover classification',
    descId:
      'Dataset satelit terbuka dari European Space Agency (ESA) yang memetakan jenis permukaan bumi setiap 10 meter: hutan/pohon, kebun/semak, sawah/ladang, dan area terbangun. Dipakai dalam perhitungan infiltrasi SCS-CN.',
    descEn:
      'Open satellite dataset from the European Space Agency classifying surface cover at 10 m resolution: trees/forest, shrub/grass, cropland, and built-up areas. Used to parameterize SCS-CN runoff.',
    links: [
      {
        kind: 'article',
        labelId: 'Situs resmi ESA WorldCover',
        labelEn: 'Official ESA WorldCover site',
        href: 'https://esa-worldcover.org'
      },
      {
        kind: 'video',
        labelId: 'Video tentang ESA WorldCover',
        labelEn: 'ESA WorldCover overview',
        href: 'https://www.youtube.com/results?search_query=ESA+WorldCover+10m+land+cover'
      }
    ]
  },
  {
    id: 'ndvi-sentinel2',
    termId: 'Sentinel-2 & Perubahan Vegetasi (NDVI)',
    termEn: 'Sentinel-2 & Vegetation Change (NDVI)',
    shortId: 'Selisih kehijauan kanopi Des 2022 vs Jul 2024',
    shortEn: 'Canopy greenness delta Dec 2022 vs Jul 2024',
    descId:
      'Membandingkan indeks kehijauan tanaman (NDVI) dari citra satelit Copernicus Sentinel-2 (10 m) antara Desember 2022 dan Juli 2024. Lapisan ini menunjukkan lokasi penurunan vegetasi tanpa menyimpulkan penyebabnya (bisa akibat kebun, bukaan lahan, atau perubahan alur).',
    descEn:
      'Compares satellite vegetation greenness (NDVI) from 10 m Copernicus Sentinel-2 imagery between Dec 2022 and Jul 2024. Highlights areas where vegetation cover decreased without asserting a single cause.',
    links: [
      {
        kind: 'article',
        labelId: 'Copernicus Data Space',
        labelEn: 'Copernicus Data Space',
        href: 'https://dataspace.copernicus.eu'
      },
      {
        kind: 'video',
        labelId: 'Video apa itu NDVI & Sentinel-2',
        labelEn: 'NDVI & Sentinel-2 explained',
        href: 'https://www.youtube.com/results?search_query=apa+itu+NDVI+Sentinel+2'
      }
    ]
  },
  {
    id: 'sk35-forest',
    termId: 'Kawasan Hutan SK 35 (HL, KSA/KPA, APL)',
    termEn: 'Forest Status SK 35 (HL, KSA/KPA, APL)',
    shortId: 'Klasifikasi fungsi kawasan hutan KLHK',
    shortEn: 'KLHK statutory forest zone classes',
    descId:
      'Kategori status kawasan menurut SK Menhut/KLHK pada peta terbuka Pemkab Agam: HL (Hutan Lindung untuk menjaga tata air & lereng), KSA/KPA (Kawasan Suaka Alam / Pelestarian Alam), dan APL (Areal Penggunaan Lain di luar kawasan hutan negara).',
    descEn:
      'Statutory forest classifications from KLHK open data via Pemkab Agam: HL (Protected Forest), KSA/KPA (Nature Reserve / Conservation Area), and APL (Non-Forestry Other Use Land).',
    links: [
      {
        kind: 'article',
        labelId: 'Baca tentang Hutan Lindung',
        labelEn: 'Protected Forest (Wikipedia ID)',
        href: 'https://id.wikipedia.org/wiki/Hutan_lindung'
      },
      {
        kind: 'video',
        labelId: 'Video perbedaan HL, KSA & APL',
        labelEn: 'Forest zone classes video',
        href: 'https://www.youtube.com/results?search_query=perbedaan+hutan+lindung+KSA+APL'
      }
    ]
  },
  {
    id: 'andosol',
    termId: 'Tanah Andosol & Kambisol',
    termEn: 'Andosol & Kambisol Soils',
    shortId: 'Jenis tanah vulkanik lereng gunung',
    shortEn: 'Volcanic highland soil types',
    descId:
      'Andosol adalah tanah subur berwarna gelap yang terbentuk dari abu gunung api (seperti lereng Gunung Singgalang) — sangat gembur dan mudah menyerap air, namun rentan tergerus jika jenuh air di lereng curam. Kambisol adalah tanah muda yang mulai berkembang di bawahnya.',
    descEn:
      'Andosol is porous, dark volcanic ash soil common on mountain slopes like Singgalang — fertile and permeable when vegetated, yet prone to erosion when saturated on steep slopes. Kambisol is moderately developed young soil.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca Tanah Andosol (Wikipedia)',
        labelEn: 'Andosol on Wikipedia',
        href: 'https://id.wikipedia.org/wiki/Andosol'
      },
      {
        kind: 'video',
        labelId: 'Video karakteristik tanah Andosol',
        labelEn: 'Andosol soil properties video',
        href: 'https://www.youtube.com/results?search_query=karakteristik+tanah+andosol+vulkanik'
      }
    ]
  },
  {
    id: 'gerakan-tanah',
    termId: 'Peta Gerakan Tanah (Pemkab Agam / BPBD)',
    termEn: 'Ground Movement Map (Pemkab Agam / BPBD)',
    shortId: 'Poligon referensi kelas Tinggi, Sedang, Rendah',
    shortEn: 'High, Medium & Low reference polygons',
    descId:
      'Lapisan poligon data terbuka milik Pemkab Agam / BPBD yang merangkum zona kerentanan gerakan tanah regional (Tinggi, Sedang, Rendah). Ditampilkan sebagai lapisan referensi peta terbuka, bukan hasil pengukuran teknis per rumah.',
    descEn:
      'Open-data regional polygon layer published by Pemkab Agam / BPBD summarizing ground-movement susceptibility classes (High, Medium, Low). Displayed strictly as reference context, not a house-level survey.',
    links: [
      {
        kind: 'article',
        labelId: 'Portal PVMBG Badan Geologi',
        labelEn: 'PVMBG Geological Agency',
        href: 'https://vsi.esdm.go.id'
      }
    ]
  },
  {
    id: 'verified-vs-dashed',
    termId: 'Jalur Terverifikasi vs Garis Putus-putus',
    termEn: 'Verified Channels vs Dashed Estimates',
    shortId: 'Biru solid vs sian/jingga putus-putus',
    shortEn: 'Solid blue vs dashed cyan/amber lines',
    descId:
      'Garis biru tua solid adalah sungai/bandar yang sudah dicek pada citra/lapangan (dapat diedit di Editor). Garis sian putus-putus adalah peta referensi BIG RBI 50K, sedangkan garis jingga putus-putus adalah hasil perhitungan matematis arah kemiringan dari DEMNAS 8 m.',
    descEn:
      'Solid blue lines are field/imagery-verified waterways (editable in Editor). Dashed cyan lines come from official BIG RBI 50K reference maps, while dashed amber lines are mathematical D8 elevation-slope paths from DEMNAS.',
    links: [
      {
        kind: 'article',
        labelId: 'Tentang OpenStreetMap Waterways',
        labelEn: 'OpenStreetMap Waterways Wiki',
        href: 'https://wiki.openstreetmap.org/wiki/Key:waterway'
      }
    ]
  },
  {
    id: 'local-waterways',
    termId: 'Batang, Anak Sungai, Bandar & Gorong-gorong',
    termEn: 'Batang, Anak Sungai, Canal & Culvert',
    shortId: 'Istilah alur air & bangunan silang lokal',
    shortEn: 'Local waterway & road-crossing terms',
    descId:
      'Di Sumatera Barat, "Batang" berarti sungai utama (mis. Batang Ngalai), "Anak Sungai" adalah cabang alur kecil dari lereng, "Bandar/Parit" adalah saluran irigasi/drainase tepi jalan, dan "Gorong-gorong" adalah saluran tertutup di bawah badan jalan.',
    descEn:
      'In West Sumatra, "Batang" denotes a main river (e.g. Batang Ngalai), "Anak Sungai" is a tributary stream, "Bandar/Parit" is an open roadside canal or drain, and "Gorong-gorong" is a culvert carrying water beneath a road.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca tentang Gorong-gorong',
        labelEn: 'Culvert on Wikipedia',
        href: 'https://id.wikipedia.org/wiki/Gorong-gorong'
      }
    ]
  },
  {
    id: 'nagari-jorong',
    termId: 'Batas Nagari (Resmi) vs Batas Jorong',
    termEn: 'Official Nagari vs Jorong Boundaries',
    shortId: 'Poligon BIG Juni 2026 & batas jorong lokal',
    shortEn: 'BIG June 2026 polygon & community Jorong zones',
    descId:
      'Garis hijau putus-putus adalah batas resmi Nagari Balingka (kode BIG 13.06.05.2003, luas 29,89 km²). Batas antar Jorong (Subarang, Koto Hilalang, Pahambatan) belum tersedia terbuka secara digital sehingga bertanda "Indikatif" hingga disahkan bersama Wali Nagari di Editor.',
    descEn:
      'The dashed green boundary is the official BIG June 2026 Nagari Balingka extent (13.06.05.2003, 29.89 km²). Sub-village Jorong boundaries are not yet openly published and remain marked "Indicative" until verified with local authorities.',
    links: [
      {
        kind: 'article',
        labelId: 'Baca tentang Nagari (Wikipedia)',
        labelEn: 'Nagari on Wikipedia',
        href: 'https://id.wikipedia.org/wiki/Nagari'
      }
    ]
  }
];
