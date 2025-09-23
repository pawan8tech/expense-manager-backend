import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    userName: {
      type: String,
      required: [true, "Please add the User Name"],
    },
    email: {
      type: String,
      required: [true, "Please Add Email"],
      unique: [true, "this Email already taken"],
    },
    password: {
      type: String,
      required: [true, "Plese add the Password"],
    },
  },
  {
    timestamps: true,
  }
);
export default mongoose.model("User", userSchema);
