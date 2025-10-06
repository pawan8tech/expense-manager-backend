import expressAsyncHandler from "express-async-handler";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/userModel.js";

export const registerUser = expressAsyncHandler(async (req, res) => {
  console.log(req.body);
  const { userName, email, password } = req.body;

  if (!userName || !email || !password) {
    res.status(400).json({ message: "All fields are mandatory" });
  }

  const userAvailable = await User.findOne({ email });
  if (userAvailable) {
    res.status(400).json({ message: "User already Available" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    userName,
    email,
    password: hashedPassword,
  });
  if (user) {
    res.status(201).json({ _id: user.id, email: user.email });
  }

  res.json({ message: "user successfully register" });
});

export const loginUser = expressAsyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ message: "All fields are mandatory" });
  }

  const user = await User.findOne({ email });

  if (user && (await bcrypt.compare(password, user.password))) {
    // Access Token (short-lived)
    const accessToken = jwt.sign(
      {
        user: {
          userName: user.userName,
          email: user.email,
          id: user.id,
        },
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" } // ⚡ shorter expiry (recommended)
    );

    // Refresh Token (long-lived)
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "7d" } // 7 days
    );

    // Send refresh token in HttpOnly cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      accessToken,
      user: {
        id: user.id,
        userName: user.userName,
        email: user.email,
      },
    });
  } else {
    res.status(401).json({ message: "Email or Password is not valid" });
  }
});

export const refreshTokenController = expressAsyncHandler(async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) {
    res.status(401).json({ message: "Refresh token missing" });
  }

  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET, async (err, decoded) => {
    if (err) {
    res.status(403).json({ message: "Invalid or expired refresh token", error: err.message });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }

    // Issue new access token
    const accessToken = jwt.sign(
      {
        user: {
          userName: user.userName,
          email: user.email,
          id: user.id,
        },
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    res.json({ accessToken });
  });
});


export const currentUser = expressAsyncHandler(async (req, res) => {
  console.log(req);
  res.json(req.user);
});

