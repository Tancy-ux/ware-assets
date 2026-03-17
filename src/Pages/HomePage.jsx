import Fonts from "../components/Fonts";
import Logos from "../components/Logos";
import Colors from "../components/Colors";
import Footer from "../components/Footer";
import Assets from "../components/Assets";

export default function HomePage() {
  return (
    <div id="home">
      <div className="">
        <Assets />
        <hr />
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
