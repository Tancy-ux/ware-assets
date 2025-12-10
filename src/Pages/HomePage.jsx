import Fonts from "../components/Fonts";
import Logos from "../components/Logos";
import Colors from "../components/Colors";
import Footer from "../components/Footer";

export default function HomePage() {
  return (
    <div id="home">
      <div className="max-h-screen">
        <Colors />
        <hr />
        <Fonts />
        <hr />
        <Logos />
        <hr />
        <Footer />
      </div>
    </div>
  );
}
