#!/usr/bin/env node
// Android 15+ dibuja la app de borde a borde: sin esto, la barra de navegación
// del móvil tapa el menú inferior de la web. Reescribe el MainActivity que genera
// `npx cap add android` para dejar a la WebView fuera de las barras del sistema.
const fs = require('fs');
const path = require('path');

const javaRoot = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java');

function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (entry.name === 'MainActivity.java') {
      return full;
    }
  }
  return null;
}

const file = findMainActivity(javaRoot);
if (!file) {
  console.error('No se encuentra MainActivity.java en ' + javaRoot + '. Ejecuta antes `npx cap add android`.');
  process.exit(1);
}

const pkg = (fs.readFileSync(file, 'utf8').match(/^package\s+([\w.]+);/m) || [])[1];
if (!pkg) {
  console.error('MainActivity.java no tiene línea package: ' + file);
  process.exit(1);
}

fs.writeFileSync(file, `package ${pkg};

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
`);
console.log('MainActivity ajustado a las barras del sistema: ' + path.relative(process.cwd(), file));
