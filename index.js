const express = require('express');
const cors = require('cors');
const app = express()
const jwt = require('jsonwebtoken');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port=process.env.PORT || 5000
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_KEY);

//middlewires
app.use(cors())
app.use(express.json())

//database connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.skhdz.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri)
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

//middlewire JWT
function verifyJWT(req,res,next){
    const authHeaders=req.headers.authorization;
    if(!authHeaders){
        res.status(401).send('Unauthorized Access')
    }
    const token=authHeaders.split(' ')[1]
    jwt.verify(token,process.env.ACCESS_TOKEN,function(err,decoded){
        if(err){
            return res.status(403).send({message:'Access Forbiddem'})
        }
        req.decoded=decoded;
        next();
    })
}

async function run(){
    try{
        const appointmentOptionCollection=client.db('doctorsPortal').collection('appointmentOptions')
        const bookingsCollection=client.db('doctorsPortal').collection('bookings')
        const usersCollection=client.db('doctorsPortal').collection('users')
        const doctorsCollection=client.db('doctorsPortal').collection('doctors')
        const paymentsCollection=client.db('doctorsPortal').collection('payments')

        //middlewire Varify Addmin
        const varifyAdmin=async (req,res,next)=>{
            const decodedEmail=req.decoded.email;
            const query={email:decodedEmail}
            const user=await usersCollection.findOne(query)
            if(user?.role!=='admin'){
                return res.status(403).send({message:'Forbidded'})
            }
            next();
        }

        app.get('/appointmentOptions',async(req,res)=>{
             const date=req.query.date;
            const query={}
            const options=await appointmentOptionCollection.find(query).toArray()
            //selected date available slots
            const bookingQuery={appointmentDate:date}
            const alreadyBooked=await bookingsCollection.find(bookingQuery).toArray();

            options.forEach(option=>{
                const optionBooked=alreadyBooked.filter(book=>book.treatment===option.name)
                const bookSlots=optionBooked.map(option=>option.slot)
                const remainingSlots=option.slots.filter(slot=>!bookSlots.includes(slot))
                option.slots=remainingSlots;
            })
            res.send(options)
        })
        //bookings
        app.get('/bookings',verifyJWT,async(req,res)=>{
            const email=req.query.email;
            const decodedEmail=req.decoded.email;
            if(email!==decodedEmail){
                return res.status(403).send({message:'Unauthorized'})
            }
            const query={email:email}
            const result=await bookingsCollection.find(query).toArray()
            res.send(result)
        })

        app.get('/bookings/:id',async(req,res)=>{
            const id=req.params.id;
            const filter={_id:ObjectId(id)}
            const result = await bookingsCollection.findOne(filter)
            res.send(result)
        })

        app.post('/bookings',async (req,res)=>{
            const booking=req.body;
            const query={
                appointmentDate:booking.appointmentDate,
                email:booking.email,
                treatment:booking.treatment
            }
            const alreadyBooked=await bookingsCollection.find(query).toArray()
            if(alreadyBooked.length){
                return res.send({acknowledged:false,message:`Already Booked in ${booking.appointmentDate}`})
            }
            const result=await bookingsCollection.insertOne(booking)
            res.send(result)
        })


        //JWT
        app.get('/jwt',async(req,res)=>{
            const email=req.query.email;
            const query={email:email}
            const user=await usersCollection.findOne(query)
            if(user){
                const token=jwt.sign({email},process.env.ACCESS_TOKEN,{expiresIn:'1h'})
                return res.send({accessToken:token})
            }
            res.status(403).send({accessToken:'UnAuthoried'})
        })
        //user operations
        app.get('/users',async(req,res)=>{
            const query={}
            const result=await usersCollection.find(query).toArray()
            res.send(result)
        })
        app.get('/users/admin/:email',async(req,res)=>{
            const email=req.params.email;
            const query={email:email}
            const user=await usersCollection.findOne(query)
            res.send({isAdmin: user?.role==='admin'})
        })
        app.post('/users',async (req,res)=>{
            const user=req.body;
            const result=await usersCollection.insertOne(user)
            res.send(result)
        })
        app.put('/users/admin/:id',verifyJWT,varifyAdmin,async(req,res)=>{
           
            const id=req.params.id;
            const filter={_id:ObjectId(id)}
            const updatedDoc={
                $set:{
                    role:'admin'
                }
            }
            const options={upsert:true};

            const result=await usersCollection.updateOne(filter,updatedDoc,options);
            res.send(result)
        })
        
        //spiciality
        app.get('/appointmentSpeciality',async(req,res)=>{
            const query={}
            const result=await appointmentOptionCollection.find(query).project({name:1}).toArray();
            res.send(result)
        })
        //doctors
        app.get('/doctors',verifyJWT,varifyAdmin,async(req,res)=>{
            const query={}
            const doctors=await doctorsCollection.find(query).toArray()
            res.send(doctors)
        })
        app.post('/doctors',verifyJWT,varifyAdmin,async (req,res)=>{
            const doctor=req.body;
            console.log(doctor)
            const result=await doctorsCollection.insertOne(doctor)
            res.send(result)
        })
        app.delete('/doctors/:id',verifyJWT,varifyAdmin,async (req,res)=>{
            const id=req.params.id;
            const query={_id:ObjectId(id)}
            const result=await doctorsCollection.deleteOne(query)
            res.send(result);
        })
        //add price
        // app.get('/addprice',async (req,res)=>{
        //     const filter={}
        //     const updatedDoc={
        //         $set:{
        //             price:99
        //         }
        //     }
        //     const options={upsert:true};
        //     const result=await appointmentOptionCollection.updateMany(filter,updatedDoc,options)
        //     res.send(result)
        // })

        //stripe integration
        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body;
            const price =booking.price;
            const amount=price*100;
            const paymentIntent = await stripe.paymentIntents.create({
              amount: amount,
              currency: "usd",
              "payment_method_types": [
                "card"
              ],
            });
          
            res.send({
              clientSecret: paymentIntent.client_secret,
            });
          });
          //
          app.post('/payment',async(req,res)=>{
            const data=req.body;
            console.log(data)
            const result=await paymentsCollection.insertOne(data);
            const bookingId=data.bookingId;
            const filter={_id:ObjectId(bookingId)}
            const updateDoc={
                $set:{
                    payment:true,
                    transectionId:data.tarnsactionId
                }
            }
            const options={upsert:true};
            const updateDone=await bookingsCollection.updateOne(filter,updateDoc,options)
            res.send(updateDone)
          })
    }
    finally{
    }
}
run().catch(err=>console.log(err))

app.get('/',async(req,res)=>{
    res.send('Doctors Portal Server is Running')
})
app.listen(port,()=>{
    console.log(`${port} is Running`);
})